---
name: cz-cli
description: "Delegate ClickZetta Lakehouse OPERATIONS (run SQL, manage tables/schemas, create Studio tasks, set up sync/ingest pipelines, configure profiles) to the cz-cli agent. TRIGGER when user explicitly mentions ClickZetta, Lakehouse, cz-cli, or a known profile/workspace name AND wants to EXECUTE an operation (query data, create/alter tables, deploy tasks, build pipelines, set up a new connection). SKIP when (1) user is developing the cz-cli tool itself (cwd is the cz-cli source repo, editing CLI source/tests, debugging build/install/unlink/permission issues), (2) only discussing cz-cli design/code without wanting to run anything on Lakehouse, or (3) the current project already has its own datasource query capabilities (e.g. project has AGENTS.md or skills that provide SQL execution endpoints) — do not intercept generic 'query data' or 'run SQL' requests that belong to the host project's own toolchain."
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

#### Offline integration sync (`cz-cli task integration`)
Configure offline data-integration (batch sync) task content. Create the task skeleton first, then configure its content:

```bash
# 1) Create the task skeleton (single-table → INTEGRATION; multi/whole-db → MULTI_DI)
cz-cli task create my_sync --type INTEGRATION
cz-cli task create my_db_sync --type MULTI_DI

# 2) Configure content
#    single-table: creates the sink table from the source DDL + generates a default field mapping
cz-cli task integration setup my_sync --sync-type single \
  --source-datasource my_mysql --source-schema app --source-table orders \
  --sink-datasource lakehouse --sink-schema public --sink-table orders
#    single-table PARTITION (opt-in via --partitioned; default behavior is a plain non-partition table):
#      static  — whole batch to one partition value; auto-creates PARTITIONED BY (dt STRING):
cz-cli task integration setup my_sync --sync-type single \
  --source-datasource my_mysql --source-schema app --source-table orders \
  --sink-datasource lakehouse --sink-schema public --sink-table orders_di \
  --partitioned --partitions 'dt=${bizdate}'
#      dynamic — per-row routing by a source column (must exist in the source table):
cz-cli task integration setup my_sync --sync-type single \
  --source-datasource my_mysql --source-schema app --source-table orders \
  --sink-datasource lakehouse --sink-schema public --sink-table orders_di \
  --partitioned --dynamic-partition 'dt:create_time'
#    multi-table: one job per table (no table creation; the running task creates them)
cz-cli task integration setup my_db_sync --sync-type multi \
  --source-datasource my_mysql --source-schema app --source-tables orders,users,items \
  --sink-datasource lakehouse --sink-schema public
#    whole-db: mirror entire databases
cz-cli task integration setup my_db_sync --sync-type whole_db \
  --source-datasource my_mysql --source-schema app --source-dbs app,inventory \
  --sink-datasource lakehouse --sink-schema public

# 3) Inspect current config (read before editing)
cz-cli task integration show my_sync

# 4) Edit field mapping / sync params (applied & saved immediately — no UI needed)
#    single-table — column-mapping is a FULL replace (include every row to keep):
cz-cli task integration edit my_sync \
  --column-mapping '[{"source":"id","sink":"id"},{"source":"name","sink":"name"}]' \
  --parallelism 4 --error-limit -1 --m-bytes 8 --split-pk id --where "dt = bizdate"
#    multi/whole-db — table mapping + write modes + naming rules + grouping strategy:
cz-cli task integration edit my_db_sync \
  --table-mapping '[{"source":"app.orders","sink":"public.orders"}]' \
  --pk-write-mode OVERWRITE --non-pk-write-mode OVERWRITE \
  --schema-rule '{SOURCE_DATABASE}' --table-rule '{SOURCE_DATABASE}_{SOURCE_TABLE}' \
  --parallelism 4 --batch-size 4 --connections 4
```

Notes:
- `setup` does NOT change field mapping/params on an existing task — use `edit`. `edit` does NOT change source/sink tables — use `setup`.
- **Partition tables (single-table)**: the user must declare it explicitly. `setup --partitioned` auto-creates a `PARTITIONED BY (dt STRING)` sink table. Two mutually-exclusive modes: `--partitions 'dt=${bizdate}'` (static — whole batch to one partition value) or `--dynamic-partition 'dt:source_col'` (dynamic — each row routed by a source column; if the source column is missing, confirm the correct one with the user). Partition column defaults to `dt`. Without these flags the sink is a plain non-partition table (unchanged behavior).
- Datasource types are auto-resolved from the datasource name/ID; no need to pass type codes.
- **`--where` with date/time scheduling params** (e.g. `bizdate`, `$[yyyyMMdd]`, monthly partitions): look up the correct Studio scheduling-parameter syntax first (`cz-cli ai-guide` / docs). Do NOT invent parameter formats.
- Integration tasks must execute on an **INTEGRATION-type vcluster** — pick one via the vcluster list, not the default/GENERAL vc.

#### Realtime CDC pipeline lifecycle (`cz-cli task cdc`)

For **multi-table CDC pipelines** (MULTI_REALTIME, fileType 281 — created via `cz-cli task create-realtime-sync`). These commands manage the pipeline and its per-table incremental sync. They do NOT apply to single-table Kafka streaming tasks (fileType 14) — use `task start` / `task stop` for those.

```bash
# List CDC pipeline tasks
cz-cli task cdc list --name my_pipeline

# List the tables in a pipeline — returns the per-table ids used by the *-table ops below
cz-cli task cdc tables my_pipeline

# Per-table incremental sync control (--table-ids is comma-separated ids from 'task cdc tables')
cz-cli task cdc start-table my_pipeline --table-ids 101,102
cz-cli task cdc stop-table my_pipeline --table-ids 101
cz-cli task cdc resync-table my_pipeline --table-ids 101   # re-snapshot
cz-cli task cdc pause-table my_pipeline --table-ids 101
cz-cli task cdc recover-table my_pipeline --table-ids 101

# Take the whole pipeline offline (back to draft)
cz-cli task cdc offline my_pipeline
```

Notes:
- All `task cdc` commands validate the task is fileType 281; running them on any other type returns a `NOT_A_CDC_PIPELINE` error with guidance.
- Get table ids from `task cdc tables` first — the `*-table` ops require them.

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
cz-agent llm show
```

**Step 2 — If active LLM is configured (kind != "none"), you MUST use agent run:**

```bash
cz-agent run "<request>" --dangerously-skip-permissions
```

The output includes a `session_id`. Use it to inspect the run:
- `cz-agent session status <session_id>` — current state (`busy`/`retry` with `progress`, `idle` with `result`, or `error`)
- `cz-agent export <session_id>` — full conversation (messages, tool calls, reasoning, text). Wait until `status` is `idle` before exporting; otherwise the conversation may still be in progress.

**Step 3 — ONLY if no active LLM (kind: "none" or empty list), fall back to direct commands:**

Decompose the request into concrete `cz-cli` subcommands (`sql`, `schema`, `table`, `task`, `runs`, `job`, `datasource`, `profile`, etc.), execute them, and synthesize the result.

Use direct commands for local setup and diagnostics even when agent path is available: `cz-cli profile ...`, `cz-cli -p <profile> status`, `cz-agent llm ...`, `cz-cli --help`.

With session continuity:

```bash
cz-agent run "<request>" --dangerously-skip-permissions --session <session_id>
```

Reuse `session_id` for follow-ups on the same topic. Omit `--session` to start fresh.

## Async mode (non-TTY / long-running tasks)

In non-TTY environments (e.g. as a subagent from Claude Code), async mode activates automatically — no `--async` flag needed. The command returns immediately with a session ID:

```bash
cz-agent run "<request>" --dangerously-skip-permissions
```

Returns immediately with a session ID:
```json
{"session_id": "01JXF3K...", "status": "running", "message": "Session submitted asynchronously"}
```

### Poll status

```bash
cz-agent session status <session_id> [--wait]
```

By default this returns the current status once. With `--wait`, it keeps waiting and streams progress until completion or timeout.

While running:
```json
{"session_id": "01JXF3K...", "status": "busy", "progress": "$ cz-cli table list -o table"}
```

Other progress examples you may see during polling:
- `"💭 Thinking..."` — LLM is reasoning
- `"✏ Generating response..."` — LLM is writing the reply
- `"✱ Grep \"error\" · 3 matches"` — running a search tool
- `"↻ Retry (attempt 2)"` — retrying a failed LLM call (paired with a `retry` field describing the reason)

When complete:
```json
{"session_id": "01JXF3K...", "status": "idle", "result": "Here are the results:\n..."}
```

The `result` field is the final text reply. For full conversation details (thinking, tool calls, intermediate text), use `cz-agent export <session_id>`.

If the session does not exist:
```json
{"session_id": "ses_invalid", "error": "Session not found"}
```
(exits with code 1)

### Retrieve full conversation (thinking + tool calls + text)

```bash
cz-agent export <session_id>
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
SESSION=$(cz-agent run "complex analysis" --async --dangerously-skip-permissions | jq -r '.session_id')

# 2. Poll until done, printing progress along the way
while true; do
  STATUS=$(cz-agent session status $SESSION)
  STATE=$(echo "$STATUS" | jq -r '.status')
  if [ "$STATE" = "idle" ]; then
    echo "$STATUS" | jq -r '.result'
    break
  fi
  echo "$STATUS" | jq -r '.progress // empty'
  sleep 1
done

# Need full conversation (thinking + tool calls)?
cz-agent export $SESSION
```

### With session continuity (async)

```bash
# First turn
SESSION=$(cz-agent run "describe sales table" --async --dangerously-skip-permissions | jq -r '.session_id')
# ... wait for completion ...

# Follow-up turn on same session
cz-agent run "now show row counts" --async --dangerously-skip-permissions --session $SESSION
```

### Important notes for async mode

- **Permissions:** Always use `--dangerously-skip-permissions` — async mode cannot handle interactive permission prompts
- **Server requirement:** An agent runtime server must be running (or will be started automatically)
- **Error handling:** If session is already busy, returns `{"error": "session busy"}`

## Multi-environment (profiles)

When the user specifies an environment or profile (e.g. "use uat_test", "on the test instance"):

```bash
cz-agent run "<request>" --profile uat_test --dangerously-skip-permissions
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
