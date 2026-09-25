"""Read SKILL.md frontmatter without third-party packages.

Covers the YAML subset skills use in practice: plain and quoted scalars,
folded (>) and literal (|) block scalars, plain scalars continued on indented
lines, one level of nested maps, and simple lists. Anything more exotic comes
back as a best-effort string; validate.py reports what it cannot read.
"""

import re
import textwrap
from pathlib import Path

FRONTMATTER = re.compile(
    r"\A---[ \t]*\r?\n(?:(.*?)\r?\n)?---[ \t]*(?:\r?\n|\Z)(.*)\Z", re.S
)
KEY = re.compile(r"^([A-Za-z0-9_-]+):(?:[ \t]+(.*?))?[ \t]*$")
NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def name_problems(name):
    """Return the Agent Skills spec violations for a skill name."""
    if not name:
        return ["name is empty"]
    problems = []
    if len(name) > 64:
        problems.append(f"name is {len(name)} characters (max 64)")
    if not NAME.match(name):
        problems.append(
            "name must use lowercase letters, digits and single hyphens, "
            "without a leading or trailing hyphen"
        )
    return problems


def split(text):
    """Return (frontmatter, body). frontmatter is None when the file has none."""
    match = FRONTMATTER.match(text)
    if not match:
        return None, text
    return match.group(1) or "", match.group(2)


def parse(front):
    """Parse top-level frontmatter keys into str, list, or dict values."""
    fields = {}
    lines = front.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        i += 1
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = KEY.match(line)
        if not match:
            continue
        key, raw = match.group(1), match.group(2) or ""
        block = []
        while i < len(lines) and (not lines[i].strip() or lines[i][:1] in " \t"):
            block.append(lines[i])
            i += 1
        while block and not block[-1].strip():
            block.pop()
        fields[key] = _value(raw, block)
    return fields


def load(path):
    """Read a SKILL.md and return its parts."""
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    front, body = split(text)
    return {
        "text": text,
        "has_frontmatter": front is not None,
        "fields": parse(front) if front is not None else {},
        "body": body,
    }


def _value(raw, block):
    if raw[:1] in (">", "|"):
        if raw[0] == "|":
            return textwrap.dedent("\n".join(block)).strip()
        return " ".join(line.strip() for line in block if line.strip())
    if raw:
        continued = " ".join(line.strip() for line in block if line.strip())
        return _scalar(f"{raw} {continued}" if continued else raw)
    items = [line.strip() for line in block if line.strip()]
    if items and all(item == "-" or item.startswith("- ") for item in items):
        return [_scalar(item[1:]) for item in items]
    mapping = {}
    for item in items:
        match = KEY.match(item)
        if match:
            mapping[match.group(1)] = _scalar(match.group(2) or "")
    return mapping


def _scalar(value):
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        inner = value[1:-1]
        return inner.replace("''", "'") if value[0] == "'" else inner.replace('\\"', '"')
    return value
