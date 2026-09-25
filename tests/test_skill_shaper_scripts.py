"""Tests for skill-shaper's scan.py and validate.py.

Run from the repository root:  python3 -m unittest discover -s tests
"""

import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "skills" / "skill-shaper" / "scripts"
sys.path.insert(0, str(SCRIPTS))

from skillmd import load, name_problems, parse  # noqa: E402


def write_skill(folder, name=None, description="Does a thing. Use when testing.", body="Body.\n", extra=""):
    folder.mkdir(parents=True, exist_ok=True)
    name = folder.name if name is None else name
    (folder / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {description}\n{extra}---\n{body}", encoding="utf-8"
    )
    return folder


def run(script, *args, home):
    env = {**os.environ, "HOME": str(home)}
    return subprocess.run(
        [sys.executable, str(SCRIPTS / script), *map(str, args)],
        capture_output=True, text=True, env=env,
    )


class FrontmatterTest(unittest.TestCase):
    def test_block_and_nested_values(self):
        fields = parse(textwrap.dedent("""\
            name: demo
            description: >
              Folded text
              on two lines.
            quoted: "a \\"b\\" c"
            metadata:
              author: someone
              version: "1.0"
            tools:
              - one
              - two
            """))
        self.assertEqual(fields["description"], "Folded text on two lines.")
        self.assertEqual(fields["quoted"], 'a "b" c')
        self.assertEqual(fields["metadata"], {"author": "someone", "version": "1.0"})
        self.assertEqual(fields["tools"], ["one", "two"])

    def test_trailing_spaces_after_fence(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "SKILL.md"
            path.write_text("---   \nname: x\ndescription: y\n---\nbody\n", encoding="utf-8")
            info = load(path)
            self.assertTrue(info["has_frontmatter"])
            self.assertEqual(info["fields"]["name"], "x")

    def test_name_rules(self):
        self.assertEqual(name_problems("pdf-tools"), [])
        for bad in ("PDF", "-pdf", "pdf-", "pdf--tools", "pdf_tools", "a" * 65, ""):
            self.assertTrue(name_problems(bad), bad)


class ValidateTest(unittest.TestCase):
    def test_skill_shaper_passes_its_own_checks(self):
        result = run("validate.py", REPO / "skills" / "skill-shaper", "--json", home=REPO)
        report = json.loads(result.stdout)
        self.assertEqual(result.returncode, 0, report)
        self.assertEqual(report["errors"], [])
        self.assertEqual(report["warnings"], [])

    def test_errors(self):
        with tempfile.TemporaryDirectory() as tmp:
            cases = {
                "name-mismatch": dict(name="other"),
                "long-description": dict(description="x" * 1025),
                "xml-description": dict(description="Use when <b>bold</b>."),
                "missing-link": dict(body="Read [this](references/missing.md).\n"),
                "bad-slash": dict(body="Read [this](references\\\\x.md).\n"),
            }
            for folder, kwargs in cases.items():
                with self.subTest(folder):
                    skill = write_skill(Path(tmp) / folder, **kwargs)
                    result = run("validate.py", skill, home=tmp)
                    self.assertEqual(result.returncode, 1, result.stdout)
                    self.assertIn("error:", result.stdout)

    def test_warnings_do_not_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            skill = write_skill(
                Path(tmp) / "vague", description="Helps with documents.", extra="paths: '**/*.md'\n"
            )
            (skill / "README.md").write_text("For humans.\n")
            result = run("validate.py", skill, "--json", home=tmp)
            report = json.loads(result.stdout)
            self.assertEqual(result.returncode, 0)
            joined = " ".join(report["warnings"])
            self.assertIn("when to use", joined)
            self.assertIn("'paths' is honoured only by claude, cursor", joined)
            self.assertIn("README.md", joined)

    def test_project_path_mention_is_a_warning(self):
        with tempfile.TemporaryDirectory() as tmp:
            skill = write_skill(Path(tmp) / "project-path", body="Run the project's `scripts/release.mjs`.\n")
            result = run("validate.py", skill, "--json", home=tmp)
            report = json.loads(result.stdout)
            self.assertEqual(result.returncode, 0, report)
            self.assertTrue(any("not in the skill" in w for w in report["warnings"]))

    def test_project_skill_resolves_paths_from_repo_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "repo"
            (repo / "scripts").mkdir(parents=True)
            (repo / "scripts" / "release.mjs").write_text("// release\n")
            skill = write_skill(repo / ".agents" / "skills" / "release", body="Run `scripts/release.mjs`.\n")
            report = json.loads(run("validate.py", skill, "--json", home=tmp).stdout)
            self.assertEqual(report["warnings"], [])

    def test_nested_references_warn(self):
        with tempfile.TemporaryDirectory() as tmp:
            skill = write_skill(Path(tmp) / "nested", body="Read [a](references/a.md).\n")
            (skill / "references").mkdir()
            (skill / "references" / "a.md").write_text("See [b](b.md).\n")
            (skill / "references" / "b.md").write_text("Leaf.\n")
            report = json.loads(run("validate.py", skill, "--json", home=tmp).stdout)
            self.assertTrue(any("one level deep" in w for w in report["warnings"]))

    def test_explicit_invocation_needs_codex_policy(self):
        with tempfile.TemporaryDirectory() as tmp:
            skill = write_skill(Path(tmp) / "deploy-thing", extra="disable-model-invocation: true\n")
            report = json.loads(run("validate.py", skill, "--json", home=tmp).stdout)
            self.assertTrue(any("allow_implicit_invocation" in w for w in report["warnings"]))

            (skill / "agents").mkdir()
            (skill / "agents" / "openai.yaml").write_text("policy:\n  allow_implicit_invocation: false\n")
            report = json.loads(run("validate.py", skill, "--json", home=tmp).stdout)
            self.assertEqual(report["warnings"], [])

    def test_imperative_description_warns(self):
        with tempfile.TemporaryDirectory() as tmp:
            skill = write_skill(Path(tmp) / "imperative", description="Extract action items. Use when asked.")
            report = json.loads(run("validate.py", skill, "--json", home=tmp).stdout)
            self.assertTrue(any("opens as a command" in w for w in report["warnings"]))


class ScanTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        agents = self.home / ".agents" / "skills"
        write_skill(agents / "shared")
        (self.home / ".claude" / "skills").mkdir(parents=True)
        (self.home / ".claude" / "skills" / "shared").symlink_to(agents / "shared")
        write_skill(self.home / ".cursor" / "skills" / "shared", body="Edited copy.\n")
        write_skill(self.home / ".codex" / "skills" / "codex-only")
        (self.home / ".agents" / "skills" / "broken").mkdir()
        (self.home / ".agents" / "skills" / "broken" / "SKILL.md").write_text("no frontmatter\n")
        self.project = self.home / "work" / "repo"
        (self.project / ".git").mkdir(parents=True)
        write_skill(self.project / ".agents" / "skills" / "local-only")

    def tearDown(self):
        self.tmp.cleanup()

    def scan(self, *args):
        result = run("scan.py", "--project", self.project, "--json", *args, home=self.home)
        return result, json.loads(result.stdout)

    def test_report(self):
        result, report = self.scan()
        self.assertEqual(result.returncode, 0, result.stderr)
        skills = {s["key"]: s for s in report["skills"]}

        shared = skills["shared"]
        self.assertEqual(shared["seen_by"], ["claude", "codex", "cursor"])
        self.assertTrue(any(n.startswith("copies differ") for n in shared["notes"]))
        self.assertIn("cursor loads 2 separate copies", shared["notes"])
        linked = [loc for loc in shared["locations"] if loc["target"]]
        self.assertEqual(len(linked), 1)

        self.assertEqual(skills["codex-only"]["seen_by"], ["cursor"])
        self.assertEqual(skills["local-only"]["seen_by"], ["codex", "cursor"])
        self.assertTrue(skills["broken"]["problems"])

    def test_home_flag_overrides_environment(self):
        with tempfile.TemporaryDirectory() as other:
            result = run("scan.py", "--project", self.project, "--home", self.home, "--json", home=other)
            keys = {s["key"] for s in json.loads(result.stdout)["skills"]}
            self.assertIn("shared", keys)

    def test_missing_home_is_an_error(self):
        result = run("scan.py", "--project", self.project, "--home", self.home / "nope", home=self.home)
        self.assertEqual(result.returncode, 2)
        self.assertIn("not a directory", result.stderr)

    def test_check_name(self):
        free = run("scan.py", "--project", self.project, "--check-name", "brand-new", home=self.home)
        self.assertEqual(free.returncode, 0, free.stdout)
        for taken in ("shared", "local-only", "skill-creator", "create-skill", "synced", "Bad_Name"):
            with self.subTest(taken):
                result = run("scan.py", "--project", self.project, "--check-name", taken, home=self.home)
                self.assertEqual(result.returncode, 1, result.stdout)


if __name__ == "__main__":
    unittest.main()
