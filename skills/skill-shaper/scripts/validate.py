#!/usr/bin/env python3
"""Check a skill folder against the Agent Skills spec and portable practice.

Usage:
  validate.py <skill-dir> [--json]

Errors break the spec or leave the agent pointing at files that do not exist.
Warnings flag choices that usually cost routing accuracy or context: missing
"when to use", agent-specific fields, oversized bodies, nested references.
Exits 1 when there are errors.
"""

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from skillmd import load, name_problems  # noqa: E402

SPEC_FIELDS = {"name", "description", "license", "compatibility", "metadata", "allowed-tools"}
# Fields some agents honour and others ignore. Keep in sync with
# references/placement.md.
AGENT_FIELDS = {
    "when_to_use": ["claude"],
    "argument-hint": ["claude"],
    "arguments": ["claude"],
    "disable-model-invocation": ["claude", "cursor"],
    "user-invocable": ["claude"],
    "disallowed-tools": ["claude"],
    "model": ["claude"],
    "effort": ["claude"],
    "context": ["claude"],
    "agent": ["claude"],
    "background": ["claude"],
    "hooks": ["claude"],
    "paths": ["claude", "cursor"],
    "shell": ["claude"],
    "icon": ["cursor"],
    "color": ["cursor"],
    "globs": ["cursor (legacy, use paths)"],
}
HUMAN_FILES = ("README.md", "CHANGELOG.md", "INSTALL.md", "CONTRIBUTING.md")
# Common first words of descriptions written as commands ("Extract ..."), which
# read as instructions to the agent rather than a statement of what the skill does.
IMPERATIVE_VERBS = {
    "add", "analyze", "analyse", "build", "check", "convert", "create", "deploy", "draft",
    "extract", "fix", "generate", "help", "make", "manage", "prepare", "process", "review",
    "run", "summarize", "summarise", "transcribe", "translate", "turn", "update", "write",
}

LINK = re.compile(r"\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
BARE_PATH = re.compile(r"`((?:scripts|references|assets)/[^`\s]+)`")
XML_TAG = re.compile(r"</?[A-Za-z][\w:-]*(?:\s[^<>]*)?>")
BODY_LINES = 500
BODY_TOKENS = 5000
REFERENCE_TOC_LINES = 100


def validate(skill_dir):
    errors, warnings = [], []
    root = Path(skill_dir).resolve()
    skill_md = root / "SKILL.md"
    if not skill_md.is_file():
        return [f"no SKILL.md in {root}"], warnings

    info = load(skill_md)
    if not info["has_frontmatter"]:
        return ["SKILL.md must start with YAML frontmatter between --- lines"], warnings
    fields, body = info["fields"], info["body"]

    check_name(fields.get("name"), root, errors, warnings)
    check_description(fields.get("description"), errors, warnings)

    compatibility = fields.get("compatibility")
    if compatibility is not None and not (isinstance(compatibility, str) and 1 <= len(compatibility) <= 500):
        errors.append("compatibility must be a string of 1-500 characters")
    if "metadata" in fields and not isinstance(fields["metadata"], dict):
        errors.append("metadata must be a map of string keys to string values")

    codex_explicit = codex_explicit_only(root)
    for field in sorted(fields.keys() - SPEC_FIELDS):
        if field == "disable-model-invocation" and str(fields[field]).lower() == "true":
            if not codex_explicit:
                warnings.append(
                    "'disable-model-invocation' stops Claude Code and Cursor only; Codex will still load the "
                    "skill on its own unless agents/openai.yaml sets policy.allow_implicit_invocation: false"
                )
        elif field in AGENT_FIELDS:
            warnings.append(f"'{field}' is honoured only by {', '.join(AGENT_FIELDS[field])}; other agents ignore it")
        else:
            warnings.append(f"'{field}' is not an Agent Skills field; no agent is documented to read it")

    check_body(body, root, errors, warnings)
    check_references(root, errors, warnings)

    for name in HUMAN_FILES:
        if (root / name).exists():
            warnings.append(f"{name} is written for humans; agents never load it from a skill folder")
    return errors, warnings


def codex_explicit_only(root):
    """True when agents/openai.yaml turns off implicit invocation in Codex."""
    policy = root / "agents" / "openai.yaml"
    if not policy.is_file():
        return False
    text = policy.read_text(encoding="utf-8", errors="replace")
    return re.search(r"^\s*allow_implicit_invocation:\s*false\s*$", text, re.M) is not None


def check_name(name, root, errors, warnings):
    if not isinstance(name, str) or not name:
        errors.append("frontmatter needs a name")
        return
    errors.extend(name_problems(name))
    if name != root.name:
        errors.append(f"name '{name}' must match the folder name '{root.name}'")
    if name.lower() == "synced":
        errors.append("'synced' is reserved by Claude Code for skills synced from claude.ai")
    if "anthropic" in name or "claude" in name:
        warnings.append("names containing 'anthropic' or 'claude' are rejected by the Claude API skill upload")


def check_description(description, errors, warnings):
    if not isinstance(description, str) or not description.strip():
        errors.append("frontmatter needs a description; it is the only text agents see when routing")
        return
    description = description.strip()
    if len(description) > 1024:
        errors.append(f"description is {len(description)} characters (max 1024)")
    if XML_TAG.search(description):
        errors.append("description must not contain XML tags")
    if not re.search(r"\buse\b|\bwhen\b", description, re.I):
        warnings.append("description never says when to use the skill ('Use when ...')")
    if re.match(r"(I|You|We)\b", description):
        warnings.append("description should be third person ('Extracts ...', not 'I/You ...')")
    first = re.match(r"[A-Za-z]+", description)
    if first and first.group(0).lower() in IMPERATIVE_VERBS:
        warnings.append(
            f"description opens as a command ('{first.group(0)} ...'); "
            "state what the skill does in third person, e.g. 'Extracts ...'"
        )


def check_body(body, root, errors, warnings):
    if not body.strip():
        warnings.append("SKILL.md has no body; the skill gives the agent nothing after it triggers")
        return
    lines = body.count("\n") + 1
    if lines > BODY_LINES:
        warnings.append(f"body is {lines} lines (keep under {BODY_LINES}); move detail to references/")
    tokens = len(body) // 4
    if tokens > BODY_TOKENS:
        warnings.append(f"body is about {tokens} tokens (keep under {BODY_TOKENS})")
    check_links(body, root, root, errors, warnings=warnings)


def check_links(text, base, root, errors, source="SKILL.md", bare_paths=True, warnings=None):
    """Report local links in text that point at missing files.

    A missing Markdown link is an error. A backticked scripts/, references/ or
    assets/ path is checked only in SKILL.md, and a miss is a warning, because
    it may name a file in the user's project rather than in the skill."""
    targets = [(m.group(1), False) for m in LINK.finditer(text)]
    if bare_paths:
        targets += [(path, True) for path in BARE_PATH.findall(text)]
    found = []
    for target, bare in targets:
        if re.match(r"[a-z][a-z0-9+.-]*:|#|mailto:", target, re.I) or target.startswith("<"):
            continue
        if "\\" in target:
            errors.append(f"{source} links to '{target}'; use forward slashes")
            continue
        clean = target.split("#")[0].rstrip(".,;:")
        if not clean or "<" in clean or "*" in clean:
            continue
        path = (base / clean).resolve()
        if not path.exists():
            project = project_root(root)
            if bare and project is not None and (project / clean).exists():
                continue
            if bare and warnings is not None:
                warnings.append(
                    f"{source} mentions '{clean}', which is not in the skill; "
                    "fine if it names a project file, otherwise add it or fix the path"
                )
            else:
                errors.append(f"{source} points to '{clean}', which does not exist")
        elif root in path.parents or path == root:
            found.append(path)
    return found


def project_root(skill_root):
    """The repository a project skill lives in, or None for a personal skill.

    Project skills sit at <repo>/.agents/skills/<name>, <repo>/.claude/skills/<name>
    and so on, so the repository is three levels up from the skill folder."""
    skills_dir = skill_root.parent
    if skills_dir.name == "skills" and skills_dir.parent.name.startswith("."):
        repo = skills_dir.parent.parent
        if repo != Path.home():
            return repo
    return None


def check_references(root, errors, warnings):
    references = root / "references"
    if not references.is_dir():
        return
    nested, no_contents = [], []
    for ref in sorted(references.rglob("*.md")):
        text = ref.read_text(encoding="utf-8", errors="replace")
        rel = ref.relative_to(root).as_posix()
        linked = check_links(text, ref.parent, root, errors, source=rel, bare_paths=False)
        if any(p.suffix == ".md" and references in p.parents and p != ref for p in linked):
            nested.append(rel)
        if text.count("\n") + 1 > REFERENCE_TOC_LINES and not re.search(r"^#+\s*contents\b", text[:3000], re.I | re.M):
            no_contents.append(rel)
    if nested:
        warnings.append(
            f"reference files link to other reference files ({summarize(nested)}); "
            "keep references one level deep from SKILL.md"
        )
    if no_contents:
        warnings.append(
            f"reference files over {REFERENCE_TOC_LINES} lines lack a Contents section at the top "
            f"({summarize(no_contents)})"
        )


def summarize(paths, shown=3):
    listed = ", ".join(paths[:shown])
    more = f" and {len(paths) - shown} more" if len(paths) > shown else ""
    return listed + more


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("skill_dir")
    parser.add_argument("--json", action="store_true", help="print JSON")
    args = parser.parse_args()

    errors, warnings = validate(args.skill_dir)
    if args.json:
        print(json.dumps({"ok": not errors, "errors": errors, "warnings": warnings}, indent=2))
    else:
        for warning in warnings:
            print(f"warning: {warning}")
        for error in errors:
            print(f"error: {error}")
        if not errors and not warnings:
            print("ok")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
