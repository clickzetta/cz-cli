---
name: cz-cli
description: "CLI tool for ClickZetta Lakehouse. Use this skill when the user needs to run SQL queries, develop or schedule Studio tasks, check run status and logs, or manage tables and schemas."
generated_cli_version: "0.5.17"
generated_with: "cz-cli-skill-generator/1.0.0"
command_inventory_source: "click-command-tree"
command_count: 77
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

The following companion skills can be installed alongside `cz-cli` via `cz-cli install-skills`:

- **lakehouse-python-sdk** — Lakehouse Python/Shell task engineering: develop, rewrite, optimize, troubleshoot. Covers connector, BulkLoad, IGS, Studio params, datasource, and CREATE TABLE DDL; MUST trigger on: develop/write/create/modify/rewrite/optimize Python or Shell task; BulkLoad batch upload; IGS realtime ingest; connector query/write; Python task error/diagnosis; CREATE TABLE / partition / bucket / index DDL.
- **lakehouse-doc** — ClickZetta Lakehouse official documentation. Covers SQL syntax, data types, functions, DDL/DML commands, dynamic tables, materialized views, access control, VCluster, data lake, AI functions, etc. When the user writes or asks about SQL syntax or Lakehouse dialect specifics, **MUST** consult lakehouse-doc skill references first to ensure accuracy.

**If no row matches**: proceed with cz-cli commands directly.

### Rule 2.1 — MUST consult lakehouse-doc skill for SQL commands

When the user request involves any of the following, **MUST** consult **lakehouse-doc** skill references before answering or generating SQL:

- Writing, modifying, or optimizing SQL statements (DDL / DML / DQL)
- Asking about ClickZetta Lakehouse SQL dialect syntax, keywords, or function usage
- Using data types, type casting, or datetime formats
- Creating or altering tables, views, materialized views, dynamic tables, external tables
- Data import/export (COPY INTO, PUT/GET, BulkLoad, Pipe)
- Access control (GRANT / REVOKE), roles, permissions
- VCluster configuration and management
- Index creation and usage (inverted index, BloomFilter, vector index)
- AI functions, vector search, semantic views
- Information Schema system view queries

**Rationale**: ClickZetta Lakehouse SQL dialect differs from standard SQL and other databases. Relying on general knowledge may produce incorrect syntax. Consulting lakehouse-doc significantly improves answer accuracy and confidence.

### Rule 3 — Development ends at save; execution requires separate authorization

When the user says "develop", "write", "create", or "modify" a task, the work is **complete once the script is saved successfully**.
After saving, tell the user: "The task has been saved as a draft. Scheduling is not yet active. Let me know explicitly if you want to publish or execute it."

**Do NOT** auto-publish, auto-trigger execution, or auto-submit a backfill after saving — even if those steps seem like the logical next thing. Every phase that produces a real side effect requires the user to express intent and grant authorization separately.

**Exception**: If the user's original request *explicitly* authorized all subsequent steps (e.g. "create and immediately go live", "develop and run it now"), AND Rule 1 already confirmed that intent at the start, the Agent may proceed through the authorized steps without stopping again at each phase. Do not re-ask for confirmation that was already given.

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
JOB=$(cz-cli sql "SELECT * FROM orders LIMIT 100" --field job_id) && cz-cli job status $JOB -o toon && cz-cli job result $JOB -o toon | head -12

# Parallel: two independent lookups at the same time
cz-cli task content my_task -o toon & cz-cli runs list --task my_task -o toon & wait

# Chain: save then verify
cz-cli task save-content my_task --file script.sql && cz-cli task content my_task -o toon
```

Key tools:
- `--field <name>` — extract one value as raw text: `cz-cli sql "..." --field job_id` → `2026042818122957849079780`
- `-o toon` — line-per-field output, works with `grep`/`head`
- `-o json` — single-line JSON, parse in code only (do NOT pipe to grep/head)

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
- `cz-cli task content <name_or_id>` — Get task script (draft)
- `cz-cli task save-content <name_or_id> --file script.sql` — Save script
- `cz-cli task save-config <name_or_id> --cron "0 0 8 * * ? *"` — Save schedule (sec min hour day month week year)
- `cz-cli task online <name_or_id> -y` — Publish task
- `cz-cli task offline <name_or_id> -y` — Take offline (IRREVERSIBLE)
- `cz-cli task execute <name_or_id>` — Ad-hoc execution
- `cz-cli task flow dag <flow>` / `task flow create-node` / `task flow bind` / `task flow submit` — Flow operations

### Runs & Attempts
- `cz-cli runs list [--task T --status S --run-type SCHEDULE|REFILL --from D --to D]`
- `cz-cli runs detail <run_id_or_task>` / `cz-cli runs logs <run_id_or_task>` / `cz-cli runs wait <id> --timeout N`
- `cz-cli runs stop <id> -y` / `cz-cli runs refill <task> --from D --to D` / `cz-cli runs stats --from D --to D`
- `cz-cli attempts list <run_id_or_task>` / `cz-cli attempts log <run_id_or_task> [--attempt-id N]`

### Agent (AI Agent)
- `cz-cli agent status` — Check agent health
- `cz-cli agent ask "question" [--conversation-id ID]` — Ask the agent

## Command Inventory (Generated)

### `agent`
- `cz-cli agent [OPTIONS] COMMAND [ARGS]...` - Interact with ClickZetta Studio AI Agent via HTTP.
  - `cz agent status` — Check if the AI Agent service is running
  - `cz agent ask "How many tables are in my schema?"` — Ask the agent a question
- `cz-cli agent ask [OPTIONS] QUESTION` - Send a question to the AI Agent and print the answer. QUESTION is the text to send to the agent. Use --conversation-id / -c to continue a previous conversation (multi-turn).
  - `cz agent ask "How many tables are in my schema?"` — Ask the agent a question and get a JSON response
  - `cz agent ask "List all tables" --output pretty` — Ask the agent and print the answer in plain text
  - `cz agent ask "Explain this query" --agent-url http://localhost:8000` — Ask using a specific agent endpoint
- `cz-cli agent status [OPTIONS]` - Check the health of the AI Agent service.
  - `cz agent status` — Check agent health using the default profile
  - `cz agent status --agent-url http://localhost:8000` — Check agent health at a specific URL

### `ai-guide`
- `cz-cli ai-guide [OPTIONS]` - Output structured AI Agent usage guide (toon by default).

### `attempts`
- `cz-cli attempts [OPTIONS] COMMAND [ARGS]...` - Manage attempt records and logs for task runs (run_id first, not attempt_id).
  - `cz-cli attempts list my_task` — List attempts for the latest run of 'my_task'
  - `cz-cli attempts log my_task` — Get log for the latest attempt of 'my_task'
- `cz-cli attempts list [OPTIONS] [RUN_ID_OR_TASK_NAME]` - List attempt records by run_id or task_name. Prefer task_name; numeric input is treated as run_id.
  - `cz-cli attempts list my_task` — List attempts for the latest run of 'my_task'
  - `cz-cli attempts list 123456789` — List attempts by run_id
  - `cz-cli attempts list my_task --limit 5` — List up to 5 attempts
- `cz-cli attempts log [OPTIONS] RUN_ID_OR_TASK_NAME` - Get attempt log by run_id or task_name. Prefer task_name; numeric input is treated as run_id.
  - `cz-cli attempts log my_task` — Get log for the latest attempt of 'my_task'
  - `cz-cli attempts log 123456789` — Get log by run_id
- `cz-cli attempts logs [OPTIONS] RUN_ID_OR_TASK_NAME` - Get attempt log by run_id or task_name. Prefer task_name; numeric input is treated as run_id.
  - `cz-cli attempts log my_task` — Get log for the latest attempt of 'my_task'
  - `cz-cli attempts log 123456789` — Get log by run_id

### `install-skills`
- `cz-cli install-skills [OPTIONS]` - Install AI skills for coding assistants (interactive).

### `job`
- `cz-cli job [OPTIONS] COMMAND [ARGS]...` - Job performance: download plan/profile and analyze.
  - `cz-cli job status <job_id>` — Check status of an async SQL job
  - `cz-cli job result <job_id>` — Fetch result set of a completed job
- `cz-cli job result [OPTIONS] JOB_ID` - Fetch result set of a SQL job by job ID (waits if still running).
  - `cz-cli job result 2026042814504683112029735` — Fetch result set (waits if still running, limited to 100 rows)
  - `cz-cli job result --no-limit 2026042814504683112029735` — Fetch full result set without row limit
- `cz-cli job status [OPTIONS] JOB_ID` - Check status / summary of a SQL job.
  - `cz-cli job status 2026042814504683112029735` — Check job status by job ID
  - `cz-cli --profile dev job status 2026042814504683112029735 -o table` — Check job status with a named profile in table format

### `profile`
- `cz-cli profile [OPTIONS] COMMAND [ARGS]...` - Manage connection profiles. Use --show-secret on list/detail to reveal secrets.
  - `cz-cli profile list` — List all configured profiles (sensitive fields redacted by default)
  - `cz-cli profile create dev --username alice --password s3cr3t --instance my-inst --workspace ws1` — Create a profile with username/password
  - `cz-cli profile discover --studio-url "https://acme.accounts.clickzetta.com" --username alice --password s3cr3t` — Discover regions and instances from a Studio URL
- `cz-cli profile create [OPTIONS] NAME` - Create a new profile.
  - `cz-cli profile create dev --username alice --password s3cr3t --instance my-inst --workspace ws1` — Create a profile with username/password auth
  - `cz-cli profile create prod --pat eyJhbG... --instance prod-inst --workspace main` — Create a profile with PAT (Personal Access Token) auth
  - `cz-cli profile create local --jdbc "jdbc:clickzetta://localhost/ws?user=dev&password=dev"` — Create a profile from a JDBC URL
- `cz-cli profile delete [OPTIONS] NAME` - Delete a profile.
  - `cz-cli profile delete old-dev` — Delete the 'old-dev' profile
- `cz-cli profile detail [OPTIONS] NAME` - Show full configuration for a profile by name. Sensitive fields (pat, password) are redacted by default to prevent accidental exposure in logs or screen shares. Use --show-secret to display the actual values.
  - `cz-cli profile detail dev` — Show config for 'dev' profile (password/PAT redacted by default)
  - `cz-cli profile detail dev --show-secret` — Show config including plaintext password/PAT
- `cz-cli profile discover [OPTIONS]` - Authenticate via Studio URL and discover regions + instances.
  - `cz-cli profile discover --studio-url "https://acme.accounts.clickzetta.com" --username alice --password s3cr3t` — Discover regions and instances from an account URL
- `cz-cli profile list [OPTIONS]` - List all configured profiles.
  - `cz-cli profile list` — List all profiles (PAT shown as first-8-chars****)
  - `cz-cli profile list --show-secret` — List all profiles with PAT/password in plain text
- `cz-cli profile list-workspaces [OPTIONS]` - List workspaces for a region (and optionally a specific instance).
  - `cz-cli profile list-workspaces --studio-url "https://acme.accounts.clickzetta.com" --username alice --password s3cr3t --region cn-shanghai-alicloud` — List workspaces in a region
- `cz-cli profile render-command [OPTIONS]` - Generate a `cz-cli profile create` command from discovered metadata.
  - `cz-cli profile render-command --studio-url "https://acme.accounts.clickzetta.com" --username alice --password s3cr3t --region cn-shanghai-alicloud --workspace my_ws` — Generate a profile create command
- `cz-cli profile show [OPTIONS] NAME` - Show full configuration for a profile by name. Sensitive fields (pat, password) are redacted by default to prevent accidental exposure in logs or screen shares. Use --show-secret to display the actual values.
  - `cz-cli profile detail dev` — Show config for 'dev' profile (password/PAT redacted by default)
  - `cz-cli profile detail dev --show-secret` — Show config including plaintext password/PAT
- `cz-cli profile status [OPTIONS]` - Show connection status and version info.
  - `cz-cli profile status` — Check connection using default profile
  - `cz-cli --profile dev profile status` — Check connection for 'dev' profile
  - `cz-cli profile status -o table` — Show connection status in table format
- `cz-cli profile update [OPTIONS] NAME KEY VALUE` - Update a profile field.
  - `cz-cli profile update dev workspace ws2` — Switch workspace for an existing profile
  - `cz-cli profile update dev vcluster batch` — Set a different virtual cluster
- `cz-cli profile use [OPTIONS] NAME` - Set a profile as default.
  - `cz-cli profile use prod` — Set 'prod' as the default profile

### `runs`
- `cz-cli runs [OPTIONS] COMMAND [ARGS]...` - Manage Studio task run instances.
  - `cz-cli runs list --limit 10` — List the 10 most recent scheduled runs
  - `cz-cli runs list --task my_task --run-type REFILL --limit 5` — List backfill runs for a specific task
- `cz-cli runs deps [OPTIONS] TASK_NAME_OR_TASK_ID` - Query published/scheduled state (调度态) upstream/downstream task dependencies.
  - `cz-cli runs deps my_task` — Show published dependency graph (depth=1/1)
  - `cz-cli runs deps my_task --parent-level 2 --child-level 3` — Show published dependency graph with custom depth
- `cz-cli runs detail [OPTIONS] RUN_ID_OR_TASK_NAME` - Get full detail of one run instance by run_id or task_name (resolves latest run). Prefer task_name; numeric input is treated as run_id.
  - `cz-cli runs detail my_task` — Get latest run detail for task 'my_task'
  - `cz-cli runs detail 123456789` — Get run detail by numeric run_id
- `cz-cli runs list [OPTIONS]` - List task run instances. Defaults to SCHEDULE runs, last 24h, page 1. Use --run-type REFILL for backfill runs. Check ai_message for total count and pagination hints.
  - `cz-cli runs list --limit 10` — List 10 most recent scheduled runs
  - `cz-cli runs list --task my_task --limit 5` — Filter runs by task name
  - `cz-cli runs list --run-type REFILL --limit 5` — List backfill (REFILL) runs
  - `cz-cli runs list --status FAILED --limit 20` — List failed runs
- `cz-cli runs log [OPTIONS] RUN_ID_OR_TASK_NAME` - No description.
- `cz-cli runs logs [OPTIONS] RUN_ID_OR_TASK_NAME` - No description.
  - `cz-cli runs logs my_task` — Get execution log for the latest run of 'my_task'
  - `cz-cli runs logs 123456789` — Get log by run_id
- `cz-cli runs refill [OPTIONS] TASK_NAME_OR_ID` - [🟠 HIGH IMPACT] Submit a backfill job to re-run a task over a historical business time window. Requires user confirmation. Do NOT call this automatically — always confirm the target time window with the user first.
  - `cz-cli runs refill my_task --from 2026-04-01 --to 2026-04-03 -y` — Backfill 'my_task' for a 3-day window
  - `cz-cli runs refill my_task -y` — Submit one immediate backfill window
- `cz-cli runs stats [OPTIONS]` - Summarize run statistics (count by status/type) for the given time window.
  - `cz-cli runs stats` — Summarize run statistics for the last 24h
  - `cz-cli runs stats --task my_task` — Stats for a specific task
- `cz-cli runs stop [OPTIONS] RUN_ID_OR_TASK_NAME` - Stop a run by run_id or task_name. Prefer task_name; numeric input is treated as run_id.
  - `cz-cli runs stop my_task -y` — Stop the latest run of 'my_task' without confirmation
- `cz-cli runs wait [OPTIONS] RUN_ID_OR_TASK_NAME` - Poll one run until terminal status. Prefer task_name; numeric input is treated as run_id.
  - `cz-cli runs wait my_task` — Poll until 'my_task' latest run reaches terminal status
  - `cz-cli runs wait my_task --interval 10 --attempts 60` — Poll every 10s, up to 60 attempts

### `schema`
- `cz-cli schema [OPTIONS] COMMAND [ARGS]...` - Manage schemas.
  - `cz-cli schema list` — List all schemas in the current workspace
  - `cz-cli schema describe public` — Show tables and details for schema 'public'
- `cz-cli schema create [OPTIONS] NAME` - Create a new schema.
  - `cz-cli schema create analytics` — Create a new schema named 'analytics'
- `cz-cli schema describe [OPTIONS] NAME` - Show schema details including tables.
  - `cz-cli schema describe public` — Show tables inside schema 'public'
- `cz-cli schema drop [OPTIONS] NAME` - Drop a schema.
  - `cz-cli schema drop temp_schema` — Drop schema 'temp_schema'
- `cz-cli schema list [OPTIONS]` - List all schemas in the current workspace.
  - `cz-cli schema list` — List all schemas
  - `cz-cli schema list --like 'test%'` — Filter schemas matching 'test%'

### `sql`
- `cz-cli sql [OPTIONS] [STATEMENT]` - Execute a SQL statement. If you omit STATEMENT and stdin is not a terminal (pipe or redirect), SQL is read from stdin so literals with '!' are not mangled by the shell.
  - `cz-cli sql "SELECT 1"` — Run a simple read query
  - `cz-cli --profile dev sql "SELECT * FROM orders LIMIT 20"` — Query with a named profile
  - `cz-cli sql --file query.sql` — Execute SQL from a file
  - `cz-cli sql --write "INSERT INTO logs VALUES ('event', NOW())"` — Write operation (requires --write flag)
  - `cz-cli sql --sync "SELECT count(*) FROM big_table"` — Run synchronously (wait for results)

### `status`
- `cz-cli status [OPTIONS]` - (Deprecated, use 'profile status') Show connection status and version info.

### `table`
- `cz-cli table [OPTIONS] COMMAND [ARGS]...` - Manage tables.
  - `cz-cli table list --schema public` — List all tables in schema 'public'
  - `cz-cli table describe my_table` — Show column definitions for 'my_table'
- `cz-cli table create [OPTIONS] [DDL]` - Create a table from DDL.
  - `cz-cli table create "CREATE TABLE my_table (id BIGINT, name STRING)"` — Create a table from an inline DDL statement
  - `cz-cli table create --from-file schema.sql` — Create a table from a DDL file
- `cz-cli table describe [OPTIONS] NAME` - Show table structure including columns and metadata.
  - `cz-cli table describe my_table` — Show columns and types for 'my_table'
  - `cz-cli table describe public.orders` — Describe table with schema prefix
- `cz-cli table drop [OPTIONS] NAME` - Drop a table.
  - `cz-cli table drop old_table` — Drop table 'old_table'
- `cz-cli table history [OPTIONS] [NAME]` - Show table history including deleted tables.
  - `cz-cli table history` — Show history of all tables including deleted ones
  - `cz-cli table history --schema analytics` — Show table history for schema 'analytics'
- `cz-cli table list [OPTIONS]` - List all tables in the current or specified schema.
  - `cz-cli table list --schema public` — List tables in schema 'public'
  - `cz-cli table list --schema analytics --like 'fact_%'` — Filter by name pattern
  - `cz-cli table list --limit 50` — Limit to 50 results
- `cz-cli table preview [OPTIONS] NAME` - Preview table data.
  - `cz-cli table preview my_table` — Preview first 10 rows of 'my_table'
  - `cz-cli table preview my_table --limit 50` — Preview 50 rows
- `cz-cli table stats [OPTIONS] NAME` - Show table statistics using job summary.
  - `cz-cli table stats my_table` — Show row count and job summary for 'my_table'

### `task`
- `cz-cli task [OPTIONS] COMMAND [ARGS]...` - Manage Studio schedule tasks and flow tasks.
  - `cz-cli task create demo_python_task --type PYTHON --folder 0 --description "demo"` — Create a Python task in the root folder
  - `cz-cli task list --limit 10` — List the first 10 tasks
- `cz-cli task content [OPTIONS] TASK_NAME_OR_ID` - Show task draft state (草稿态): content + schedule config.
  - `cz-cli task content my_task` — Show draft content + config for task 'my_task'
  - `cz-cli task content 123456` — Show draft content + config by task ID
- `cz-cli task create [OPTIONS] TASK_NAME` - Create a new Studio task (draft). `--type` is required (SQL/PYTHON/SHELL/SPARK/FLOW). Follow up with `task save-content` to add content, then `task save-config` for schedule, then `task online` to activate. For Python task development, use the lakehouse-python-sdk skill.
  - `cz-cli task create demo_python_task --type PYTHON --folder 0 --description "demo"` — Create a Python task in the root folder
  - `cz-cli task create daily_etl --type SQL --folder my_folder` — Create a SQL task in a named folder
  - `cz-cli task create cleanup_job --type SHELL --folder 0` — Create a shell task in the root folder
- `cz-cli task create-folder [OPTIONS] FOLDER_NAME` - Create a new task folder. Use --parent to nest inside an existing folder (default: root). For Python task development, use the lakehouse-python-sdk skill.
  - `cz-cli task create-folder my_folder` — Create a folder named 'my_folder' in root
  - `cz-cli task create-folder sub_folder --parent 42` — Create a subfolder under folder ID 42
- `cz-cli task deps [OPTIONS] TASK_NAME_OR_TASK_ID` - Query draft state (草稿态) upstream/downstream task dependencies.
  - `cz-cli task deps my_task` — Show draft dependency graph (depth=1/1)
  - `cz-cli task deps my_task --parent-level 2 --child-level 3` — Show draft dependency graph with custom depth
- `cz-cli task detail [OPTIONS] TASK_NAME_OR_ID` - No description.
- `cz-cli task execute [OPTIONS] TASK_NAME_OR_ID` - [Notice: SIDE EFFECT] Run one temporary execution immediately without publishing to schedule. AI agents MUST obtain explicit user approval before calling this command. There is NO -y flag — approval is obtained by asking the user, not via a CLI option. Use for ad-hoc or validation runs only.
  - `cz-cli task execute my_task` — Run a temporary execution using current task content
  - `cz-cli task execute my_task -f updated_script.py` — Run with overridden content from file
- `cz-cli task flow [OPTIONS] COMMAND [ARGS]...` - Manage Flow task nodes and dependencies.
- `cz-cli task flow bind [OPTIONS] TASK_NAME_OR_ID` - No description.
- `cz-cli task flow create-node [OPTIONS] TASK_NAME_OR_ID` - No description.
- `cz-cli task flow dag [OPTIONS] TASK_NAME_OR_ID` - No description.
- `cz-cli task flow instances [OPTIONS]` - No description.
- `cz-cli task flow node-detail [OPTIONS] TASK_NAME_OR_ID` - No description.
- `cz-cli task flow node-save [OPTIONS] TASK_NAME_OR_ID` - No description.
- `cz-cli task flow node-save-config [OPTIONS] TASK_NAME_OR_ID` - No description.
- `cz-cli task flow remove-node [OPTIONS] TASK_NAME_OR_ID` - No description.
- `cz-cli task flow submit [OPTIONS] TASK_NAME_OR_ID` - No description.
- `cz-cli task flow unbind [OPTIONS] TASK_NAME_OR_ID` - No description.
- `cz-cli task list [OPTIONS]` - List tasks in the current workspace. Supports pagination and filters. Returns page 1 only by default — check ai_message for total count.
  - `cz-cli task list --limit 10` — List first 10 tasks
  - `cz-cli task list --type PYTHON --limit 20` — List Python tasks
  - `cz-cli task list --name daily` — Search tasks with 'daily' in the name
- `cz-cli task list-folders [OPTIONS]` - List Studio task folders. Supports pagination via --page and --page-size.
  - `cz-cli task list-folders` — List all task folders
  - `cz-cli task list-folders --page 2 --page-size 20` — List page 2 with 20 items per page
- `cz-cli task offline [OPTIONS] TASK_NAME_OR_ID` - [🔴 IRREVERSIBLE] Take a task offline and clear ALL run instances (past and future). This CANNOT be undone. All historical instance records are permanently deleted. The task must have no active downstream dependencies. Requires explicit user confirmation.
  - `cz-cli task offline my_task -y` — Take task offline and clear all instances (skip confirmation)
- `cz-cli task online [OPTIONS] TASK_NAME_OR_ID` - [🟠 HIGH IMPACT] Publish a task draft to activate scheduling. Non-Flow tasks only. Requires user confirmation. Do NOT call this automatically after save — wait for explicit user instruction.
  - `cz-cli task online my_task -y` — Publish task to schedule (skip confirmation)
- `cz-cli task save [OPTIONS] TASK_NAME_OR_ID` - No description.
- `cz-cli task save-config [OPTIONS] TASK_NAME_OR_ID` - Save schedule configuration (cron, VC, schema) as a draft. Does NOT activate the schedule — run `task online` separately when ready to publish.
  - `cz-cli task save-config my_task --cron '0 0 2 * * ? *'` — Set daily 2am schedule for a task
  - `cz-cli task save-config my_task --cron '0 0 * * * ? *' --vc batch` — Set hourly schedule with specific VC
  - `cz-cli task save-config my_task --cron '0 0 2 * * ? *' --dry-run -s 00:00 -e 23:59` — Validate and preview schedule times without saving
- `cz-cli task save-content [OPTIONS] TASK_NAME_OR_ID` - Save task script content as a draft. Does NOT activate the schedule — run `task online` separately when ready to publish.
  - `cz-cli task save-content my_task --content 'SELECT 1'` — Save inline SQL content to a task
  - `cz-cli task save-content my_task -f script.py` — Save Python script from file (recommended)

### `workspace`
- `cz-cli workspace [OPTIONS] COMMAND [ARGS]...` - Manage workspaces.
  - `cz-cli workspace current` — Show the current active workspace
  - `cz-cli workspace use staging --persist` — Switch to 'staging' workspace and save to profile
- `cz-cli workspace current [OPTIONS]` - Show current workspace.
  - `cz-cli workspace current` — Show the current active workspace
- `cz-cli workspace use [OPTIONS] NAME` - Switch to a workspace using SDK hints. This command uses the SDK hint 'sdk.job.default.ns' to switch workspace context. Use --persist to also update the current profile configuration.
  - `cz-cli workspace use staging` — Show SDK hint to switch to workspace 'staging'
  - `cz-cli workspace use staging --persist` — Switch workspace and persist change to profile
  - `cz-cli workspace use staging --schema analytics --persist` — Switch workspace and default schema, then persist

## Command Risk Reference

| Risk Level      | Commands                                         | Key Concern                                                     |
|-----------------|--------------------------------------------------|-----------------------------------------------------------------|
| 🔴 Irreversible | `task offline`, `schema drop`, `table drop`      | Cannot be undone; clears history or deletes objects permanently |
| 🟠 High Impact  | `task online`, `runs refill`, `task flow submit` | Affects live schedule or re-runs historical data                |
| 🟢 Safe         | All others                                       | No side effects                                                 |
