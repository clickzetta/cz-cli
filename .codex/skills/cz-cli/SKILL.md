---
name: cz-cli
description: "CLI tool for ClickZetta Lakehouse. Use this skill when the user needs to run SQL queries, develop or schedule Studio tasks, check run status and logs, or manage tables and schemas."
license: Apache-2.0
generated_cli_version: "0.1.0"
generated_with: "cz-cli-skill-generator/1.0.0"
command_inventory_source: "click-command-tree"
command_count: 61
---

# cz-cli Skill

> [!IMPORTANT]
> `pip3 install cz-cli -U  # Must be installed to use this skill`

## AI Agent Behavior Rules

> [!IMPORTANT]
> Read these rules before invoking any command.

### Rule 1 — Clarify intent before any state-changing operation

When a task involves an operation that changes system state (publishing a schedule, taking a task offline, triggering a run, deleting an object, etc.):

**Do NOT proceed without** explicitly understanding the user's intent on all three points:
1. **Target**: Which task / table / run instance?
2. **Purpose**: Why does this need to happen now?
3. **Side-effect acknowledgment**: Does the user understand the impact (historical re-runs, schedule interruption, permanent deletion, etc.)?

Use the **AskUserQuestion tool** (not plain text) to confirm with the user, then wait for an explicit reply before executing.

Consult **Command Risk Reference** below to determine whether a command qualifies as state-changing.

### Rule 2 — Development ends at save; execution requires separate authorization

When the user says "develop", "write", "create", or "modify" a task, the work is **complete once the script is saved successfully**.
After saving, tell the user: "The task has been saved as a draft. Scheduling is not yet active. Let me know explicitly if you want to publish or execute it."

**Do NOT** auto-publish, auto-trigger execution, or auto-submit a backfill after saving — even if those steps seem like the logical next thing. Every phase that produces a real side effect requires the user to express intent and grant authorization separately.

### Rule 3 — Paginated results are not complete data

All `list` commands return only page 1 by default (typically 10 items). The `ai_message` field in the response contains the total count and the command to fetch the next page — treat it as the authoritative next-step hint and follow it. Never treat a first-page result as the full dataset.

### Rule 4 — Always pass explicit task type when creating tasks

When creating a task with `cz-cli task create`, **always** pass `--type` explicitly (`SQL` / `PYTHON` / `SHELL` / `SPARK` / `FLOW`).

- **MUST NOT** rely on default task type.
- If user intent says “Python task”, command must include `--type PYTHON`.

## Quick Start

- Inspect command options in detail: `cz-cli <subcommand> --help`

## Command Inventory (Generated)

### `ai-guide`
- `cz-cli ai-guide [OPTIONS]` - Output structured AI Agent usage guide (JSON).

### `executions`
- `cz-cli executions [OPTIONS] COMMAND [ARGS]...` - Manage execution records and logs for task runs (run_id first, not execution_id).
- `cz-cli executions list [OPTIONS] [RUN_ID_OR_TASK_NAME]` - List execution records by run_id or task_name. Prefer task_name; numeric input is treated as run_id.
- `cz-cli executions log [OPTIONS] RUN_ID_OR_TASK_NAME` - Get execution log by run_id or task_name. Prefer task_name; numeric input is treated as run_id.
- `cz-cli executions stop [OPTIONS] RUN_ID_OR_TASK_NAME` - Stop execution by run_id or task_name. Prefer task_name; numeric input is treated as run_id.

### `install-skills`
- `cz-cli install-skills [OPTIONS]` - Install AI skills for coding assistants (interactive).

### `profile`
- `cz-cli profile [OPTIONS] COMMAND [ARGS]...` - Manage connection profiles.
- `cz-cli profile create [OPTIONS] NAME` - Create a new profile.
- `cz-cli profile delete [OPTIONS] NAME` - Delete a profile.
- `cz-cli profile list [OPTIONS]` - List all configured profiles.
- `cz-cli profile show [OPTIONS] NAME` - Show full configuration for a profile by name.
- `cz-cli profile update [OPTIONS] NAME KEY VALUE` - Update a profile field.
- `cz-cli profile use [OPTIONS] NAME` - Set a profile as default.

### `runs`
- `cz-cli runs [OPTIONS] COMMAND [ARGS]...` - Manage Studio task run instances.
- `cz-cli runs detail [OPTIONS] RUN_ID_OR_TASK_NAME` - Get full detail of one run instance by run_id or task_name (resolves latest run).
- `cz-cli runs list [OPTIONS]` - List task run instances. Defaults to SCHEDULE runs, last 24h, page 1. Use --run-type REFILL for backfill runs. Check ai_message for total count and pagination hints.
- `cz-cli runs log [OPTIONS] RUN_ID_OR_TASK_NAME` - Get run log by run_id or task_name. Prefer task_name; numeric input is treated as run_id.
- `cz-cli runs refill [OPTIONS] TASK_NAME_OR_ID` - [🟠 HIGH IMPACT] Submit a backfill job to re-run a task over a historical business time window. Requires user confirmation. Do NOT call this automatically — always confirm the target time window with the user first.
- `cz-cli runs stats [OPTIONS]` - Summarize run statistics (count by status/type) for the given time window.
- `cz-cli runs stop [OPTIONS] RUN_ID_OR_TASK_NAME` - Stop a run by run_id or task_name. Prefer task_name; numeric input is treated as run_id.
- `cz-cli runs wait [OPTIONS] RUN_ID_OR_TASK_NAME` - Poll one run until terminal status. Prefer task_name; numeric input is treated as run_id.

### `schema`
- `cz-cli schema [OPTIONS] COMMAND [ARGS]...` - Manage schemas.
- `cz-cli schema create [OPTIONS] NAME` - Create a new schema.
- `cz-cli schema describe [OPTIONS] NAME` - Show schema details including tables.
- `cz-cli schema drop [OPTIONS] NAME` - Drop a schema.
- `cz-cli schema list [OPTIONS]` - List all schemas in the current workspace.

### `sql`
- `cz-cli sql [OPTIONS] [STATEMENT]` - Execute a SQL statement. If you omit STATEMENT and stdin is not a terminal (pipe or redirect), SQL is read from stdin so literals with '!' are not mangled by the shell.

### `status`
- `cz-cli status [OPTIONS] JOB_ID` - Check status of an async SQL job.

### `table`
- `cz-cli table [OPTIONS] COMMAND [ARGS]...` - Manage tables.
- `cz-cli table create [OPTIONS] [DDL]` - Create a table from DDL.
- `cz-cli table describe [OPTIONS] NAME` - Show table structure including columns and metadata.
- `cz-cli table drop [OPTIONS] NAME` - Drop a table.
- `cz-cli table history [OPTIONS] [NAME]` - Show table history including deleted tables.
- `cz-cli table list [OPTIONS]` - List all tables in the current or specified schema.
- `cz-cli table preview [OPTIONS] NAME` - Preview table data.
- `cz-cli table stats [OPTIONS] NAME` - Show table statistics using job summary.

### `task`
- `cz-cli task [OPTIONS] COMMAND [ARGS]...` - Manage Studio schedule tasks and flow tasks.
- `cz-cli task create [OPTIONS] TASK_NAME` - Create a new Studio task (draft). Follow up with `task save` to add content, then `task save-config` for schedule, then `task online` to activate.
- `cz-cli task create-folder [OPTIONS] FOLDER_NAME` - Create a new task folder. Use --parent to nest inside an existing folder (default: root).
- `cz-cli task detail [OPTIONS] TASK_NAME_OR_ID` - Show full task detail including content, config, and online status.
- `cz-cli task execute [OPTIONS] TASK_NAME_OR_ID` - [⚠️ SIDE EFFECT] Run one temporary execution immediately without publishing to schedule. Requires explicit user approval before use. Use for ad-hoc or validation runs only.
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
- `cz-cli task folders [OPTIONS]` - List Studio task folders. Supports pagination via --page and --page-size.
- `cz-cli task list [OPTIONS]` - List tasks in the current workspace. Supports pagination and filters. Returns page 1 only by default — check ai_message for total count.
- `cz-cli task offline [OPTIONS] TASK_NAME_OR_ID` - [🔴 IRREVERSIBLE] Take a task offline and clear ALL run instances (past and future). This CANNOT be undone. All historical instance records are permanently deleted. The task must have no active downstream dependencies. Requires explicit user confirmation.
- `cz-cli task online [OPTIONS] TASK_NAME_OR_ID` - [🟠 HIGH IMPACT] Publish a task draft to activate scheduling. Non-Flow tasks only. Requires user confirmation. Do NOT call this automatically after save — wait for explicit user instruction.
- `cz-cli task save [OPTIONS] TASK_NAME_OR_ID` - Save task script content as a draft. Does NOT activate the schedule — run `task online` separately when ready to publish.
- `cz-cli task save-config [OPTIONS] TASK_NAME_OR_ID` - Save schedule configuration (cron, VC, schema) as a draft. Does NOT activate the schedule — run `task online` separately when ready to publish.

### `workspace`
- `cz-cli workspace [OPTIONS] COMMAND [ARGS]...` - Manage workspaces.
- `cz-cli workspace current [OPTIONS]` - Show current workspace.
- `cz-cli workspace use [OPTIONS] NAME` - Switch to a workspace using SDK hints. This command uses the SDK hint 'sdk.job.default.ns' to switch workspace context. Use --persist to also update the current profile configuration.

## Command Risk Reference

| Risk Level      | Commands                                         | Key Concern                                                     |
|-----------------|--------------------------------------------------|-----------------------------------------------------------------|
| 🔴 Irreversible | `task offline`, `schema drop`, `table drop`      | Cannot be undone; clears history or deletes objects permanently |
| 🟠 High Impact  | `task online`, `runs refill`, `task flow submit` | Affects live schedule or re-runs historical data                |
| 🟢 Safe         | All others                                       | No side effects                                                 |
