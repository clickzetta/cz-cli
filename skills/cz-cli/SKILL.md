---
name: cz-cli
description: "Route ALL ClickZetta Lakehouse operations to cz-cli: SQL, Studio tasks, tables, pipelines, profiles. Use when user mentions ClickZetta, Lakehouse, cz-cli, or needs profile/connection configuration."
---

# cz-cli — ClickZetta Lakehouse Subagent

You have no direct Lakehouse access. Always delegate via cz-cli.

## Capabilities

### SQL & Data Operations
- Execute any SQL against Lakehouse: SELECT, DDL (CREATE/ALTER/DROP TABLE, SCHEMA, VIEW), DML (INSERT, UPDATE, DELETE, MERGE INTO)
- Run async jobs and fetch results
- Preview table data and row counts

### Table & Schema Management
- List, describe, create, and drop tables and schemas
- View table history, indexes, partitions, and statistics
- Add or update column/table comments
- Create Dynamic Tables for auto-incremental ETL (ODS→DWD→DWS pipelines)
- Create Materialized Views for pre-computed aggregations
- Create Table Streams to capture INSERT/UPDATE/DELETE changes for CDC UPSERT

### Studio Task Management
- Create, configure, deploy, and delete Studio tasks (SQL, Shell, Python, integration, flow)
- Save task content and cron schedule
- Deploy, undeploy, and execute tasks ad-hoc
- Monitor run instances: list, detail, wait, logs, stop, rerun, backfill
- View run statistics and dependencies

### Data Sync Pipelines
- Create single-table realtime CDC sync tasks (MySQL/PostgreSQL/SQL Server → Lakehouse, task_type=28)
- Create multi-table or whole-database CDC sync tasks — mirror, merge, or sharded-table consolidation (task_type=281)
- Create offline batch sync tasks with Cron scheduling — single-table (task_type=10) or multi-table (task_type=291)
- Manage sync task lifecycle: start, stop, offline, backfill, add tables, re-sync individual tables

### Data Ingestion Pipelines
- Create continuous OSS/S3/COS ingest PIPE (LIST_PURGE scan mode or EVENT_NOTIFICATION mode)
- Create continuous Kafka ingest PIPE using READ_KAFKA function
- One-shot file import from URL, local path, or Volume (COPY INTO)
- Manage PIPE lifecycle: pause, resume, adjust batch interval, view load history

### Data Recovery
- Query data at a historical point in time (Time Travel: TIMESTAMP AS OF)
- Roll back a table to a previous version (RESTORE TABLE)
- Recover accidentally dropped tables, dynamic tables, or materialized views (UNDROP TABLE)
- Inspect change history (DESC HISTORY) and deleted objects (SHOW TABLES HISTORY)
- Configure retention: data_retention_days, data_lifecycle

### Connection & Environment Management
- Create, update, delete, and switch connection profiles (multi-cloud, multi-region)
- Check connection status and switch workspace
- List and test external data sources, browse catalogs and objects
- Generate Python SDK / ZettaPark / SQLAlchemy / JDBC connection code from profile parameters

## Route to cz-cli

- Any mention of cz-cli, ClickZetta, or Lakehouse
- SQL against Lakehouse (SELECT, DDL, DML)
- Studio task development, scheduling, monitoring
- Data pipelines (sync, import, CDC, streaming)
- Profile and connection configuration
- Performance analysis and optimization

## Keep in host agent

- General programming unrelated to ClickZetta
- Local file operations, git
- Non-ClickZetta databases (PostgreSQL, MySQL standalone)

## Execution strategy

**MANDATORY: Follow this order every time. No exceptions.**

**Step 1 — MUST check LLM first:**

```bash
cz-cli agent llm show
```

**Step 2 — If active LLM is configured (kind != "none"), you MUST use agent run:**

```bash
cz-cli agent run "<request>" --format a2a --dangerously-skip-permissions
```

Do NOT use direct cz-cli subcommands when an active LLM is available. Always delegate the full request to `cz-cli agent run`.

**Step 3 — ONLY if no active LLM (kind: "none" or empty list), fall back to direct commands:**

Decompose the request into concrete `cz-cli` subcommands (`sql`, `schema`, `table`, `task`, `runs`, `job`, `datasource`, `profile`, etc.), execute them, and synthesize the result.

Use direct commands for local setup and diagnostics even when agent path is available: `cz-cli profile ...`, `cz-cli -p <profile> status`, `cz-cli agent llm ...`, `cz-cli --help`.

With session continuity:

```bash
cz-cli agent run "<request>" --format a2a --dangerously-skip-permissions --session <session_id>
```

Reuse `session_id` for follow-ups on the same topic. Omit `--session` to start fresh.

## Async mode (non-TTY / long-running tasks)

When running in non-TTY environments (e.g. as a subagent from Claude Code) or for long-running tasks, use async mode to avoid blocking:

### Submit asynchronously

```bash
cz-cli agent run "<request>" --async --format a2a --dangerously-skip-permissions
```

Returns immediately with a session ID:
```json
{"session_id": "01JXF3K...", "status": "running", "message": "Session submitted asynchronously"}
```

Note: In non-TTY with `--format a2a` or `--format json`, async mode activates automatically (no `--async` flag needed).

### Poll status

```bash
cz-cli agent session status <session_id>
```

Returns:
```json
{"session_id": "01JXF3K...", "status": "idle", "updated_at": 1748160000000}
```

- `"busy"` = still running
- `"idle"` = completed

### Retrieve full conversation (thinking + tool calls + text)

```bash
cz-cli agent export <session_id>
```

Returns complete session with all message parts:
```json
{
  "info": { "id": "...", "title": "...", "time": {...} },
  "messages": [
    {
      "info": { "role": "user" },
      "parts": [{ "type": "text", "text": "original prompt" }]
    },
    {
      "info": { "role": "assistant" },
      "parts": [
        { "type": "reasoning", "text": "thinking content..." },
        { "type": "tool", "tool": "bash", "state": { "status": "completed", "input": {...}, "output": "..." } },
        { "type": "text", "text": "final answer..." }
      ]
    }
  ]
}
```

Part types in export:
- `reasoning` — LLM thinking/reasoning blocks
- `tool` — tool calls with full input/output (bash, read, write, edit, glob, grep, etc.)
- `text` — final text response
- `step-start` / `step-finish` — step boundaries
- `patch` — code diffs
- `subtask` — delegated sub-tasks

### Async workflow pattern

```bash
# 1. Submit
SESSION=$(cz-cli agent run "complex analysis" --async --format a2a --dangerously-skip-permissions | jq -r '.session_id')

# 2. Poll until done
while [ "$(cz-cli agent session status $SESSION | jq -r '.status')" = "busy" ]; do
  sleep 5
done

# 3. Get full result
cz-cli agent export $SESSION
```

### With session continuity (async)

```bash
# First turn
SESSION=$(cz-cli agent run "describe sales table" --async --format a2a --dangerously-skip-permissions | jq -r '.session_id')
# ... wait for completion ...

# Follow-up turn on same session
cz-cli agent run "now show row counts" --async --format a2a --dangerously-skip-permissions --session $SESSION
```

### Important notes for async mode

- **Permissions:** Always use `--dangerously-skip-permissions` — async mode cannot handle interactive permission prompts
- **Server requirement:** An agent runtime server must be running (or will be started automatically)
- **Error handling:** If session is already busy, returns `{"error": "session busy"}`

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
