---
name: cz-cli
description: "CLI tool for ClickZetta Lakehouse. Use this skill when the user needs to run SQL queries, develop or schedule Studio tasks, check run status and logs, or manage tables and schemas."
generated_cli_version: "{{CLI_VERSION}}"
generated_with: "cz-cli-skill-generator/{{GENERATOR_VERSION}}"
command_inventory_source: "click-command-tree"
command_count: {{COMMAND_COUNT}}
---

# cz-cli Skill

> [!IMPORTANT]
> **Fallback**: If `cz-cli` command not present, check for a bundled binary at `scripts/<platform>/cz-cli` (e.g. `scripts/macos-arm64/cz-cli`, `scripts/linux-x86_64/cz-cli`, `scripts/windows-x86_64/cz-cli.exe`). If found, use its absolute path directly. Otherwise run `pip3 install cz-cli -U` then use `cz-cli` from PATH.

## AI Agent Behavior Rules

> [!IMPORTANT]
> Read these rules before invoking any command.

### Rule 0 — Initialize connection profile before first use

When any command returns error code `NO_PROFILE`, run `cz-cli setup --credential <base64>` if the credential string is available, or read `references/profile-setup.md` and follow the onboarding steps there. Always use the **AskUserQuestion tool** — never ask via plain text.

### Rule 1 — Clarify intent before any state-changing operation

When a task involves an operation that changes system state (publishing a schedule, taking a task offline, triggering a run, deleting an object, etc.):

**Do NOT proceed without** explicitly understanding the user's intent on all three points:
1. **Target**: Which task / table / run instance?
2. **Purpose**: Why does this need to happen now?
3. **Side-effect acknowledgment**: Does the user understand the impact (historical re-runs, schedule interruption, permanent deletion, etc.)?

Use the **AskUserQuestion tool** (not plain text) to confirm with the user, then wait for an explicit reply before executing.

Consult **Command Risk Reference** below to determine whether a command qualifies as state-changing.


### Rule 2 — Route to companion skill BEFORE acting (MUST)

> [!IMPORTANT]
> Check this routing table **before** executing any command or writing any code.
> If the user intent matches a trigger below, **MUST** invoke the listed skill immediately and stop processing in cz-cli.

The following companion skills are bundled with `cz-cli`:

- **lakehouse-python-sdk** — Lakehouse Python/Shell task engineering: develop, rewrite, optimize, troubleshoot. Covers connector, BulkLoad, IGS, Studio params, datasource, and CREATE TABLE DDL; MUST trigger on: develop/write/create/modify/rewrite/optimize Python or Shell task; BulkLoad batch upload; IGS realtime ingest; connector query/write; Python task error/diagnosis; CREATE TABLE / partition / bucket / index DDL.
- **lakehouse-doc** — ClickZetta Lakehouse official documentation. Covers SQL syntax, data types, functions, DDL/DML commands, dynamic tables, materialized views, access control, VCluster, data lake, AI functions, etc. When the user writes or asks about SQL syntax or Lakehouse dialect specifics, **MUST** consult lakehouse-doc skill references first to ensure accuracy.

**If no row matches**: proceed with cz-cli commands directly.

### Rule 3 — Development ends at save; execution requires separate authorization

When the user says "develop", "write", "create", or "modify" a task, the work is **complete once the script is saved successfully**.
After saving, tell the user: "The task has been saved as a draft. Scheduling is not yet active. Let me know explicitly if you want to publish or execute it."

**Do NOT** auto-publish, auto-trigger execution, or auto-submit a backfill after saving — even if those steps seem like the logical next thing. Every phase that produces a real side effect requires the user to express intent and grant authorization separately.

**Exception**: If the user's original request *explicitly* authorized all subsequent steps (e.g. "create and immediately go live", "develop and run it now"), AND Rule 1 already confirmed that intent at the start, the Agent may proceed through the authorized steps without stopping again at each phase. Do not re-ask for confirmation that was already given.

### Rule 3.1 — 补数/回填/重跑历史数据 → `runs refill` (NOT `task`)

When the user says "补数", "回填", "重跑历史", "backfill", "re-run historical", or "re-process date range":
- **MUST** use `cz-cli runs refill <task> --from YYYY-MM-DD --to YYYY-MM-DD [-y]`
- This command is under `runs`, **NOT** under `task` — do not look for it in task subcommands
- Requires the task to already be published (online); draft tasks cannot be backfilled

### Rule 4 — Paginated results are not complete data

All `list` commands return only page 1 by default (typically 10 items). The `ai_message` field in the response contains the total count and the command to fetch the next page — treat it as the authoritative next-step hint and follow it. Never treat a first-page result as the full dataset.

**Pagination termination rules**:
- If the user only needs "latest / recent N items": stop after page 1, do not paginate.
- If the user needs the full dataset: paginate until `ai_message` no longer contains a next-page hint.
- **Safety limit**: auto-paginate at most **3 pages** (≈ 30 items). If more exist, surface the next-page command to the user and ask whether to continue.

### Rule 5 — Always pass explicit task type when creating tasks

When creating a task with `cz-cli task create`, **always** pass `--type` explicitly (`SQL` / `PYTHON` / `SHELL` / `SPARK` / `FLOW`).
The Python SDK(connector/igs/bulkload) is using from clickzetta import connect instead of Zettapark's session.

- **MUST NOT** rely on default task type.
- If user intent says “Python task”, command must include `--type PYTHON`.
- If `--type FLOW`, immediately switch to Rule 6 — use Flow-specific commands exclusively.

### Rule 6 — Flow nodes use Flow-specific tools exclusively

When the operation target is a Flow task or any of its child nodes (`task_type=500`, or user mentions "composite task / flow / workflow"):

- **MUST** use Flow-specific commands: `task flow node-detail`, `task flow node-save`, `task flow node-save-config`, `task flow bind`, `task flow submit`, etc.
- **MUST NOT** use `task save`, `task save-config`, `task detail`, or `task online` on Flow child nodes — these tools are for regular (non-Flow) tasks only and will produce incorrect results or errors.
- **Decision rule**: if `task_type == 500` OR the user mentions flow/workflow context → use `task flow *` commands unconditionally.

### Rule 7 — Always display studio_url in final report

Responses from `task`, `runs`, and `executions` commands may include a `studio_url` field. When present, surface it in the end to the user so they can open the resource directly in Studio.

Display as a Markdown hyperlink: `[View in Studio](https://...)`. Show all studio_url values returned across all commands in the same response — do not deduplicate.

### Rule 8 — Maximize execution efficiency: parallel and chained commands

**Independent commands → parallel.  Dependent commands → chain with `--field`.**

```bash
# Async SQL: submit → poll → fetch result → preview first rows
JOB=$(cz-cli sql "SELECT * FROM orders LIMIT 100" --field job_id) && cz-cli job status $JOB --format toon && cz-cli job result $JOB --format toon | head -12

# Parallel: two independent lookups at the same time
cz-cli task content my_task --format toon & cz-cli runs list --task my_task --format toon & wait

# Chain: save then verify
cz-cli task save-content my_task --file script.sql && cz-cli task content my_task --format toon
```

Key tools:
- `--field <name>` — extract one value as raw text: `cz-cli sql "..." --field job_id` → `2026042818122957849079780`
- `--format toon` — line-per-field output, works with `grep`/`head`
- `--format json` — single-line JSON, parse in code only (do NOT pipe to grep/head)

**Shortcut**: Use `cz-cli sql --sync "..." > /tmp/res.json` to force synchronous execution (waits for results inline). Prefer `--sync` for simple/fast queries.

## Command Quick Reference

### Connection & Profile
- `cz-cli profile create <name> --username U --password P --instance I --workspace W` — Create profile
- `cz-cli profile create <name> --pat TOKEN --instance I --workspace W` — Create profile with PAT
- `cz-cli profile list` — List all profiles
- `cz-cli profile status` — Test connection, show workspace/schema
- `cz-cli profile use <name>` — Set default profile
- `cz-cli profile delete <name>` — Delete a profile
- `cz-cli profile discover --studio-url URL --username U --password P` — Discover regions/instances

### SQL Execution
- `cz-cli sql "SELECT * FROM t LIMIT 10"` — Execute SQL query
- `cz-cli sql -f query.sql` — Execute SQL from file
- `cz-cli sql --write "INSERT INTO t VALUES (...)"` — Write operation (requires --write)
- `cz-cli sql --async "SELECT count(*) FROM big_table"` — Async execution, returns job_id
- `cz-cli sql --sync "SELECT 1"` — Force synchronous execution
- `cz-cli sql -e "SELECT * FROM t WHERE id = %(id)s" --variable id=123` — Variable substitution

### Job Management (async SQL results)
- `cz-cli job status <job_id>` — Check job status
- `cz-cli job result <job_id>` — Fetch result set (waits if running, limited to 100 rows)
- `cz-cli job result --no-limit <job_id>` — Fetch full result set

### Schema & Table
- `cz-cli schema list` / `cz-cli schema describe <name>` / `cz-cli schema create <name>` / `cz-cli schema drop <name>`
- `cz-cli table list [--schema S] [--like 'pattern%']` / `cz-cli table describe <name>` / `cz-cli table preview <name> [--limit N]`
- `cz-cli table stats <name>` / `cz-cli table history [name]` / `cz-cli table create "DDL"` / `cz-cli table drop <name>`

### Workspace
- `cz-cli workspace current` — Show current workspace
- `cz-cli workspace use <name> [--persist]` — Switch workspace

### Task Scheduling (Studio)
- `cz-cli task list [--page N --page-size N]` — List tasks
- `cz-cli task create <name> --type SQL|PYTHON|SHELL|SPARK|FLOW --folder F` — Create task
- `cz-cli task content <name_or_id>` — Get task script, config and params (draft); response includes `params` array with `paramType=system` (built-in params / time expressions) or `paramType=manual` (constants)
- `cz-cli task save-content <name_or_id> --file script.sql [--params '{"key":"val","dt":"bizdate","yd":"$[yyyy-MM-dd,-1d]"}']` — Save script and optionally set params; system params (bizdate, sys_biz_day, sys_biz_datetime, sys_plan_day, sys_plan_datetime, sys_plan_timestamp, sys_task_id, sys_task_name, sys_task_owner) and time expressions starting with `$[` are auto-detected as `paramType=system`
- `cz-cli task save-config <name_or_id> --cron "0 0 8 * * ? *"` — Save schedule (sec min hour day month week year)
- `cz-cli task online <name_or_id> -y` — Publish task
- `cz-cli task offline <name_or_id> -y` — Take offline (IRREVERSIBLE)
- `cz-cli task execute <name_or_id> [--param KEY=VAL ...]` — Ad-hoc execution; auto-loads saved `manual` params as defaults (system params like `bizdate` are NOT auto-injected in adhoc mode — pass them explicitly via `--param`); warns if unresolved `${placeholders}` remain after merge (SQL tasks will fail, Python/Shell silently keep literal strings)
- `cz-cli task flow dag <flow>` / `task flow create-node` / `task flow bind` / `task flow submit` — Flow operations

### Runs & Attempts
- `cz-cli runs list [--task T --status S --run-type SCHEDULE|REFILL --from D --to D]`
- `cz-cli runs detail <run_id_or_task>` / `cz-cli runs logs <run_id_or_task>` / `cz-cli runs wait <id> --timeout N`
- `cz-cli runs refill <task> --from D --to D [-y]` — **补数/回填**: re-run scheduled instances for a historical date range (task must be online). `D` accepts `YYYY-MM-DD` (day boundary: `--from` = start of day, `--to` = 23:59:59) or `YYYY-MM-DDTHH:MM:SS` for exact datetime — **use ISO datetime for hourly/minutely tasks** to avoid missing instances
- `cz-cli attempts list <run_id_or_task>` / `cz-cli attempts log <run_id_or_task> [--attempt-id N]`

### Agent (AI Agent)
- `cz-cli agent run "<prompt>" [--session ID]` — Run AI agent with a natural-language prompt
- `cz-cli agent llm` — Manage LLM providers

## Command Inventory (Generated)

{{COMMAND_INVENTORY}}

## Command Risk Reference

| Risk Level      | Commands                                         | Key Concern                                                     |
|-----------------|--------------------------------------------------|-----------------------------------------------------------------|
| 🔴 Irreversible | `task offline`, `schema drop`, `table drop`      | Cannot be undone; clears history or deletes objects permanently |
| 🟠 High Impact  | `task online`, `runs refill`, `task flow submit` | Affects live schedule or re-runs historical data                |
| 🟢 Safe         | All others                                       | No side effects                                                 |
