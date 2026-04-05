---
name: cz-cli
description: "CLI tool for ClickZetta Lakehouse. Use this skill when the user needs to run SQL queries, develop or schedule Studio tasks, check run status and logs, or manage tables and schemas."
license: Apache-2.0
generated_cli_version: "{{CLI_VERSION}}"
generated_with: "cz-cli-skill-generator/{{GENERATOR_VERSION}}"
command_inventory_source: "click-command-tree"
command_count: {{COMMAND_COUNT}}
---

# cz-cli Skill

> [!IMPORTANT]
> **Binary**: After skill installation, use `cz-cli` from `scripts/<platform>-<arch>/cz-cli` inside the installed skill directory.
> **Fallback**: If binary not present, run `pip3 install cz-cli -U` then use `cz-cli` from PATH.

## AI Agent Behavior Rules

> [!IMPORTANT]
> Read these rules before invoking any command.

### Rule 0 — Initialize connection profile before first use

Before executing any command that requires a Lakehouse connection, run `cz-cli profile list`.

**If the result data array is empty** (no profiles configured):
1. **MUST** use the **AskUserQuestion tool** (not plain text) to ask the user to choose authentication method: PAT — Personal Access Token (recommended) or username/password.
2. Collect required fields step by step via AskUserQuestion: instance ID, workspace name, and optionally default schema and vcluster.
3. Call `cz-cli profile create <name> [--pat VALUE | --username VALUE --password VALUE] --instance VALUE --workspace VALUE`.
4. Verify success (exit_code=0, ok=true in JSON output), then proceed with the original request using `--profile <name>`.

**MUST NOT** ask the user to configure the profile themselves in a chat message — the Agent must drive the entire onboarding interactively using the AskUserQuestion tool.

**If `profile list` fails with a network/connection error** (not an empty list): report the error and ask the user to check connectivity or credentials. Do NOT enter onboarding flow.

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

### Rule 5 — Flow nodes use Flow-specific tools exclusively

When the operation target is a Flow task or any of its child nodes (`task_type=500`, or user mentions "组合任务 / flow / 工作流"):

- **MUST** use Flow-specific commands: `task flow node-detail`, `task flow node-save`, `task flow node-save-config`, `task flow bind`, `task flow submit`, etc.
- **MUST NOT** use `task save`, `task save-config`, `task detail`, or `task online` on Flow child nodes — these tools are for regular (non-Flow) tasks only and will produce incorrect results or errors.
- **Decision rule**: if `task_type == 500` OR the user mentions flow/workflow context → use `task flow *` commands unconditionally.

### Rule 6 — Always display studio_url in final report

Responses from `task`, `runs`, and `executions` commands may include a `studio_url` field. When present, surface it in the end to the user so they can open the resource directly in Studio.

## Quick Start

- Inspect command options in detail: `cz-cli <subcommand> --help`

## Examples

- `cz-cli --profile dev sql "SELECT 1"`
- `cz-cli task create demo_python_task --type PYTHON --folder 0 --description "demo"`
- `cz-cli task save demo_python_task -f ./task.py`
- `cz-cli task save-config demo_python_task --cron "0 2 * * *" --vc default --schema public`
- `cz-cli runs list --task demo_python_task --limit 5`

## Command Inventory (Generated)

{{COMMAND_INVENTORY}}

## Command Risk Reference

| Risk Level      | Commands                                         | Key Concern                                                     |
|-----------------|--------------------------------------------------|-----------------------------------------------------------------|
| 🔴 Irreversible | `task offline`, `schema drop`, `table drop`      | Cannot be undone; clears history or deletes objects permanently |
| 🟠 High Impact  | `task online`, `runs refill`, `task flow submit` | Affects live schedule or re-runs historical data                |
| 🟢 Safe         | All others                                       | No side effects                                                 |
