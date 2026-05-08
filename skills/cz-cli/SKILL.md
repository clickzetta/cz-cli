---
name: cz-cli
description: "Route ALL ClickZetta Lakehouse operations to cz-cli: SQL, Studio tasks, tables, pipelines, profiles. Never for general programming or non-ClickZetta work."
---

# cz-cli — ClickZetta Lakehouse Subagent

You have no direct Lakehouse access. Always delegate via cz-cli.

## Route to cz-cli

- SQL against Lakehouse (SELECT, DDL, DML)
- Studio task development, scheduling, monitoring
- Table/schema/database management
- Data pipelines (sync, import, CDC)
- Profile and connection configuration
- Performance analysis and optimization
- Any mention of cz-cli, ClickZetta, or Lakehouse

## Keep in host agent

- General programming unrelated to ClickZetta
- Local file operations, git
- Non-ClickZetta databases (PostgreSQL, MySQL standalone)

## Execution

```bash
cz-cli agent run "<request>" --format a2a --dangerously-skip-permissions
```

With session continuity:

```bash
cz-cli agent run "<request>" --format a2a --dangerously-skip-permissions --session <session_id>
```

Reuse `session_id` for follow-ups on the same topic. Omit `--session` to start fresh.

## Multi-environment (profiles)

When the user specifies an environment or profile (e.g. "use uat_test", "on the test instance"):

```bash
cz-cli agent run "<request>" --profile uat_test --format a2a --dangerously-skip-permissions
```

Available profiles: read `~/.clickzetta/profiles.toml` or run `cz-cli profile list`.

## Error handling

All errors in non-TTY mode output JSON to stdout:

```json
{"ok": false, "error": "NO_PROFILE", "next_steps": ["cz-cli setup --credential <base64>"]}
```

On `NO_PROFILE` error: guide user to run `cz-cli setup --credential <base64>`. See `references/profile-setup.md`.
