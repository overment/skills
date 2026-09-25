# AGENTS.md

This is a public repository of Agent Skills. Everything committed here is published.

## Rules

- One skill per folder in `skills/<name>/`, and `name` in the frontmatter must match the folder.
- Create or reshape skills with `skills/skill-shaper`. Follow its procedure rather than copying another skill's layout.
- Keep skills portable: rely on Agent Skills spec fields, and mark any agent-specific field or tool name as such in the body.
- No personal paths, hostnames, private project names, credentials, or `.env` values in any skill, eval, or test. Skills get installed on other people's machines.
- Nothing written for humans inside a skill folder (README, CHANGELOG). The repository README describes the skills.
- Every skill has `evals/<name>.md` with routing prompts that should and shouldn't trigger it. Scripts get unit tests in `tests/`.
- When a skill changes behaviour, bump `metadata.version` in its frontmatter and update its entry in the README list.

## Checks before committing

```sh
python3 -m unittest discover -s tests
python3 skills/skill-shaper/scripts/validate.py skills/<name>
```

Validation errors block a commit. Fix warnings, or know why a warning doesn't apply.
