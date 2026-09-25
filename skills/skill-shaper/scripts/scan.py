#!/usr/bin/env python3
"""List the Agent Skills your coding agents can see, and flag trouble.

Usage:
  scan.py [--project DIR] [--home DIR] [--no-global] [--json]
  scan.py --check-name NAME [--project DIR] [--home DIR]

Reads the global skill folders in your home directory, installed Claude Code
plugins, and the project folders from DIR (default: the current directory) up
to its git root. Prints each skill once with its full description, every
place it is installed, which agents load it, and problems worth knowing
before adding a neighbour: copies that drifted apart, the same skill loaded
twice by one agent, and broken frontmatter.

--check-name exits 0 when NAME is valid and free everywhere, 1 otherwise.
"""

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from skillmd import load, name_problems  # noqa: E402

# Where each agent loads skills from, per its own documentation.
# See references/placement.md before changing these.
GLOBAL_ROOTS = [
    ("~/.agents/skills", ("codex", "cursor")),
    ("~/.claude/skills", ("claude", "cursor")),
    ("~/.codex/skills", ("cursor",)),
    ("~/.cursor/skills", ("cursor",)),
]
PROJECT_ROOTS = [
    (".agents/skills", ("codex", "cursor")),
    (".claude/skills", ("claude", "cursor")),
    (".codex/skills", ("cursor",)),
    (".cursor/skills", ("cursor",)),
]
PLUGINS_FILE = "~/.claude/plugins/installed_plugins.json"

# Skills the agents ship with. A new skill with one of these names shadows
# or competes with the built-in, so --check-name treats them as taken.
BUILTINS = {
    "claude": ["batch", "claude-api", "code-review", "debug", "doctor", "loop",
               "review", "run", "run-skill-generator", "verify",
               "workflow-authoring"],
    "codex": ["plan", "skill-creator", "skill-installer"],
    "cursor": ["automate", "autopilot", "canvas", "create-hook", "create-rule",
               "create-skill", "create-subagent", "cursor-blame", "loop",
               "migrate-to-skills", "review", "review-bugbot", "review-security",
               "sdk", "shell", "split-to-prs", "statusline", "update-cli-config",
               "update-cursor-settings"],
}
RESERVED = {"claude": ["synced"]}

SKIP_DIRS = {".trash", ".git", "node_modules", "__pycache__"}
MAX_DEPTH = 3
HOME = Path.home()


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--project", default=".", help="project directory (default: .)")
    parser.add_argument("--home", help="home directory to scan instead of $HOME (containers, other users, fixtures)")
    parser.add_argument("--no-global", action="store_true", help="skip home and plugin folders")
    parser.add_argument("--json", action="store_true", help="print JSON")
    parser.add_argument("--check-name", metavar="NAME", help="check whether NAME is valid and free")
    args = parser.parse_args()

    # A mistyped path would otherwise look exactly like a machine with no skills.
    for flag, value in (("--project", args.project), ("--home", args.home)):
        if value is not None and not Path(value).expanduser().is_dir():
            parser.error(f"{flag} {value} is not a directory")
    if args.home:
        set_home(Path(args.home).expanduser().resolve())
    roots = find_roots(Path(args.project).resolve(), include_global=not args.no_global)
    entries = [entry for root in roots for entry in scan_root(root)]
    skills = group(entries)

    if args.check_name:
        sys.exit(check_name(args.check_name, skills, args.json))
    if args.json:
        print(json.dumps({"roots": [public_root(r) for r in roots], "skills": skills}, indent=2))
    else:
        print_report(roots, skills)


def set_home(path):
    """Point every ~ expansion at path. Path.expanduser reads $HOME."""
    global HOME
    HOME = path
    os.environ["HOME"] = str(path)


def find_roots(project, include_global=True):
    roots = []
    if include_global:
        for path, agents in GLOBAL_ROOTS:
            roots.append({"path": Path(path).expanduser(), "scope": "global", "agents": agents})
        roots.extend(plugin_roots())
    for directory in project_chain(project):
        for rel, agents in PROJECT_ROOTS:
            roots.append({"path": directory / rel, "scope": "project", "agents": agents})
    return [r for r in roots if r["path"].is_dir()]


def project_chain(project):
    """Directories from project up to its git root; agents read skills from each."""
    chain = [project]
    for parent in project.parents:
        if (chain[-1] / ".git").exists() or parent == HOME:
            break
        chain.append(parent)
    return chain if (chain[-1] / ".git").exists() else [project]


def plugin_roots():
    path = Path(PLUGINS_FILE).expanduser()
    try:
        installed = json.loads(path.read_text()).get("plugins", {})
    except (OSError, ValueError, AttributeError):
        return []
    roots = []
    for plugin, installs in installed.items():
        for install in installs if isinstance(installs, list) else []:
            skills = Path(install.get("installPath", "")) / "skills"
            roots.append({
                "path": skills, "scope": "plugin", "agents": ("claude",),
                "plugin": plugin.split("@")[0],
            })
    return roots


def scan_root(root):
    for skill_md in walk(root["path"]):
        yield record(skill_md, root)


def walk(root):
    """Yield SKILL.md files under root. A folder holding SKILL.md is a skill,
    so its own subfolders are resources and are not searched."""
    seen = set()
    stack = [(root, 0)]
    while stack:
        directory, depth = stack.pop()
        try:
            real = directory.resolve()
        except OSError:
            continue
        if real in seen:
            continue
        seen.add(real)
        if directory != root and (directory / "SKILL.md").is_file():
            yield directory / "SKILL.md"
            continue
        if depth >= MAX_DEPTH:
            continue
        try:
            children = [c for c in directory.iterdir() if c.is_dir() and c.name not in SKIP_DIRS]
        except OSError:
            continue
        stack.extend((child, depth + 1) for child in children)


def record(skill_md, root):
    folder = skill_md.parent
    try:
        info = load(skill_md)
    except OSError as error:
        info = {"text": "", "has_frontmatter": False, "fields": {}, "body": ""}
        unreadable = str(error)
    else:
        unreadable = None
    fields = info["fields"]
    name = fields.get("name") if isinstance(fields.get("name"), str) else ""
    description = fields.get("description")
    description = description.strip() if isinstance(description, str) else ""

    problems = []
    if unreadable:
        problems.append(f"unreadable: {unreadable}")
    elif not info["has_frontmatter"]:
        problems.append("no frontmatter, so agents cannot route to it")
    else:
        if not name:
            problems.append("no name")
        elif name != folder.name:
            problems.append(f"name '{name}' does not match folder '{folder.name}'")
        if not description:
            problems.append("no description, so agents cannot route to it")
        elif len(description) > 1024:
            problems.append(f"description is {len(description)} characters (max 1024)")

    short = name or folder.name
    key = f"{root['plugin']}:{short}" if root.get("plugin") else short
    real = folder.resolve()
    # Only symlinks from the skills folder down count; system links above it
    # (such as /var -> /private/var on macOS) are not an install choice.
    base = root["path"].parent.resolve() / root["path"].name
    unlinked = base / folder.relative_to(root["path"])
    return {
        "key": key,
        "name": short,
        "description": description,
        "path": str(folder),
        "real": str(real),
        "linked": real != unlinked,
        "root": str(root["path"]),
        "scope": root["scope"],
        "agents": list(root["agents"]),
        "hash": hashlib.sha256(info["text"].encode()).hexdigest()[:10],
        "problems": problems,
    }


def group(entries):
    by_key = {}
    for entry in entries:
        by_key.setdefault(entry["key"], []).append(entry)

    skills = []
    for key in sorted(by_key):
        items = by_key[key]
        notes = []

        content = {}
        for item in items:
            content.setdefault(item["hash"], set()).add(item["real"])
        if len(content) > 1:
            variants = " vs ".join(
                ", ".join(tilde(p) for p in sorted(reals)) for reals in content.values()
            )
            notes.append(f"copies differ: {variants}")

        agents = sorted({agent for item in items for agent in item["agents"]})
        for agent in agents:
            reals = {item["real"] for item in items if agent in item["agents"]}
            if len(reals) > 1:
                notes.append(f"{agent} loads {len(reals)} separate copies")

        scopes = {item["scope"] for item in items}
        if {"global", "project"} <= scopes:
            notes.append("installed both globally and in the project")

        described = next((i for i in items if i["description"]), items[0])
        problems = sorted({p for item in items for p in item["problems"]})
        skills.append({
            "key": key,
            "name": items[0]["name"],
            "description": described["description"],
            "seen_by": agents,
            "locations": [
                {"path": i["path"], "target": i["real"] if i["linked"] else None, "scope": i["scope"]}
                for i in items
            ],
            "notes": notes,
            "problems": problems,
        })
    return skills


def check_name(name, skills, as_json):
    reasons = list(name_problems(name))
    for skill in skills:
        if skill["name"] != name:
            continue
        where = ", ".join(tilde(loc["path"]) for loc in skill["locations"])
        if ":" in skill["key"]:
            reasons.append(f"plugin skill {skill['key']} uses it ({where}); namespaced, but its triggers compete")
        else:
            reasons.append(f"installed at {where}")
    for agent, names in BUILTINS.items():
        if name in names:
            reasons.append(f"built into {agent}")
    for agent, names in RESERVED.items():
        if name in names:
            reasons.append(f"reserved by {agent}")

    if as_json:
        print(json.dumps({"name": name, "free": not reasons, "reasons": reasons}, indent=2))
    elif reasons:
        print(f"{name}: not available")
        for reason in reasons:
            print(f"  - {reason}")
    else:
        print(f"{name}: valid and free in every scanned folder")
    return 1 if reasons else 0


def print_report(roots, skills):
    print("Folders scanned")
    for root in roots:
        path = root["path"]
        shown = tilde(path)
        if path.is_symlink():
            shown += f" -> {tilde(path.resolve())}"
        label = f"plugin {root['plugin']}" if root.get("plugin") else root["scope"]
        print(f"  {label:<24} {shown}  [{', '.join(root['agents'])}]")
    if not roots:
        print("  none found")

    print(f"\n{len(skills)} skills. Brackets list the agents that load each one. A 'link' is a symlink to")
    print("another listed folder, not a second copy; '!' lines are the only problems.\n")
    for skill in skills:
        print(f"{skill['key']}  [{', '.join(skill['seen_by'])}]")
        print(f"  {skill['description'] or '(no description)'}")
        for loc in skill["locations"]:
            target = f"  (link -> {tilde(loc['target'])})" if loc["target"] else ""
            print(f"  at {tilde(loc['path'])}{target}")
        for note in skill["notes"]:
            print(f"  ! {note}")
        for problem in skill["problems"]:
            print(f"  ! {problem}")
        print()


def public_root(root):
    out = {"path": str(root["path"]), "scope": root["scope"], "agents": list(root["agents"])}
    if root.get("plugin"):
        out["plugin"] = root["plugin"]
    return out


def tilde(path):
    path = str(path)
    home = str(HOME)
    return "~" + path[len(home):] if path == home or path.startswith(home + "/") else path


if __name__ == "__main__":
    main()
