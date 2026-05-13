---
name: cz-cli
description: "Route ALL ClickZetta Lakehouse operations to cz-cli: SQL, Studio tasks, tables, pipelines, profiles. Use when user mentions ClickZetta, Lakehouse, cz-cli, or needs profile/connection configuration."
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

## Adding a new profile

**Trigger conditions:** User says "configure new environment", "add profile", "can't connect", mentions an unknown profile name, or provides connection credentials.

### Step 1 — Collect information (guided Q&A)

If all required fields are already provided, skip directly to Step 2.

Otherwise, ask for missing ones. Accept all at once or prompt one by one.

**Required fields:**

| Field | Question to ask | Example |
|-------|----------------|---------|
| `service` | Which cloud region? (see table below, or provide the service endpoint directly) | `cn-shanghai-alicloud.api.clickzetta.com` |
| `instance` | What is the instance name? | `billingsh` |
| `workspace` | What is the workspace name? | `meter_n_bill` |
| `username` | What is the username? | `billing_admin` |
| `password` | What is the password? | — |
| `name` | What should this profile be named? (suggested format below) | `billingsh` |

**Common service endpoints (offer as options):**

| Region | service | Suggested profile prefix |
|--------|---------|--------------------------|
| Alibaba Cloud East China 2 (Shanghai) | `cn-shanghai-alicloud.api.clickzetta.com` | `cn-shanghai` |
| Tencent Cloud East China (Shanghai) | `ap-shanghai-tencentcloud.api.clickzetta.com` | `ap-shanghai` |
| Tencent Cloud North China (Beijing) | `ap-beijing-tencentcloud.api.clickzetta.com` | `ap-beijing` |
| Tencent Cloud South China (Guangzhou) | `ap-guangzhou-tencentcloud.api.clickzetta.com` | `ap-guangzhou` |
| AWS China (Beijing) | `cn-north-1-aws.api.clickzetta.com` | `cn-north-1` |

**Inference rules (reduce unnecessary questions):**
- If the user describes a cloud region in natural language (e.g. "Alibaba Cloud Shanghai", "Tencent Cloud Beijing", "阿里云上海", "腾讯云北京"), look up the service endpoint from the table above — do NOT ask the user to provide it again.
- If the user hasn't provided a profile name, suggest `<prefix>-<instance>` using the prefix from the table (e.g. `cn-shanghai-billingsh`). Confirm with the user or proceed if they don't object.

### Step 2 — Create profile

Run `cz-cli profile create` with all collected fields:

```bash
cz-cli profile create <name> \
  --username <username> \
  --password <password> \
  --instance <instance> \
  --workspace <workspace> \
  --service <service> \
  --schema public \
  --vcluster default
```

### Step 3 — Verify connection

After creating, run:

```bash
cz-cli status --profile <name>
```

A successful response looks like:
```json
{"data": {"connected": true, "workspace": "...", "time_ms": ...}}
```

If it fails, report the error and ask the user to double-check credentials or service endpoint.

## Error handling

All errors in non-TTY mode output JSON to stdout:

```json
{"ok": false, "error": "NO_PROFILE", "next_steps": ["cz-cli setup --credential <base64>"]}
```

On `NO_PROFILE` error: check if a profile can be configured via username/password (see "Adding a new profile" above). If the user has a base64 credential instead, guide them to run `cz-cli setup --credential <base64>`. See `references/profile-setup.md`.
