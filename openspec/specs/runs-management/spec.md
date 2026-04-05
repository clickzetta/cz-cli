
### Requirement: Runs and executions help signature contract
The `runs` and `executions` command families SHALL match CLI help signatures.

#### Scenario: runs group help
- **WHEN** user runs `cz-cli runs --help`
- **THEN** help shows subcommands `list/detail/wait/log/stop/refill/stats`

#### Scenario: runs detail/log/stop signatures
- **WHEN** user runs `cz-cli runs detail --help`, `cz-cli runs log --help`, or `cz-cli runs stop --help`
- **THEN** each usage requires positional `RUN_ID_OR_TASK_NAME`

#### Scenario: runs wait signature
- **WHEN** user runs `cz-cli runs wait --help`
- **THEN** usage requires positional `RUN_ID_OR_TASK_NAME`
- **AND** options include `--interval` and `--attempts`

#### Scenario: runs stats help signature
- **WHEN** user runs `cz-cli runs stats --help`
- **THEN** usage is `cz-cli runs stats [OPTIONS]`
- **AND** options include `--task`, `--from`, and `--to`

#### Scenario: executions group help
- **WHEN** user runs `cz-cli executions --help`
- **THEN** help shows subcommands `list/log/stop`

#### Scenario: executions list/log/stop signatures
- **WHEN** user runs `cz-cli executions list --help`
- **THEN** usage is `cz-cli executions list [OPTIONS] [RUN_ID_OR_TASK_NAME]`
- **AND** `cz-cli executions log|stop --help` requires positional `RUN_ID_OR_TASK_NAME`

#### Scenario: help recommends task-name-first run lookup
- **WHEN** user runs `cz-cli runs detail --help` or `cz-cli executions list --help`
- **THEN** command description recommends task-name-first lookup
- **AND** explicitly states numeric positional input is interpreted as `run_id`

### Requirement: Runs list pagination with default first page
The system SHALL support paginated run listing with default first page behavior.

#### Scenario: Default first page for runs list
- **WHEN** user runs `cz-cli runs list` without pagination arguments
- **THEN** system queries page 1 using tool schema defaults
- **AND** response includes `ai_message` that only current page is shown

#### Scenario: Runs list page navigation
- **WHEN** user runs `cz-cli runs list --page 3 --page-size 20`
- **THEN** system returns page 3 data with page size 20
- **AND** response includes pagination guidance in `ai_message`

### Requirement: Runs list supports complete filter and alias contract
The `cz-cli runs list` command SHALL support `--task <id_or_name>`, `--status`, `--run-type`, `--from`, `--to`, `--page`, `--page-size`, and `--limit`.

#### Scenario: Runs list full signature contract
- **WHEN** user consults spec for `runs list`
- **THEN** documented signature includes `cz-cli runs list [--task <id_or_name>] [--status RUNNING|SUCCESS|FAILED|WAITING] [--run-type SCHEDULE|TEMP|REFILL|1|3|4] [--from <iso>] [--to <iso>] [--page <n>] [--page-size <n>] [--limit <n>]`

#### Scenario: Runs list by task ID or task name
- **WHEN** user runs `cz-cli runs list --task TASK_ID_OR_NAME`
- **THEN** system resolves task name to task_id (or uses numeric task_id directly)
- **AND** uses the resolved `task_id` as run query filter

#### Scenario: Runs list status and run-type filters
- **WHEN** user runs `cz-cli runs list --status RUNNING --status FAILED --run-type REFILL`
- **THEN** system maps status to MCP `task_run_status_list`
- **AND** system maps run-type enum/alias (`SCHEDULE|TEMP|REFILL|1|3|4`) to `task_run_type`

#### Scenario: Runs list page-size alias
- **WHEN** user runs `cz-cli runs list --limit 1`
- **THEN** system treats `--limit` as alias of `--page-size`
- **AND** pagination response uses the aliased page size

#### Scenario: Runs list default run type and time window
- **WHEN** user runs `cz-cli runs list` with no `--run-type/--from/--to`
- **THEN** default `run_type=SCHEDULE(1)` is used
- **AND** query window defaults to recent 1 day

### Requirement: Runs detail uses exact run ID
The system SHALL retrieve run detail using `RUN_ID_OR_TASK_NAME` with run-level semantics.

#### Scenario: Get run detail by run ID
- **WHEN** user runs `cz-cli runs detail RUN_ID`
- **THEN** system invokes exact instance-detail tool by `RUN_ID`
- **AND** returns detailed run metadata and status

#### Scenario: Get run detail by task name
- **WHEN** user runs `cz-cli runs detail TASK_NAME`
- **THEN** system resolves the latest run for that task in the configured lookup window
- **AND** returns detail by resolved `task_instance_id`

### Requirement: Runs wait polling
The system SHALL provide built-in run polling with configurable interval and max attempts.

#### Scenario: Wait until terminal status
- **WHEN** user runs `cz-cli runs wait RUN_ID --interval 2 --attempts 120`
- **THEN** system polls run detail until terminal status
- **AND** returns final run detail with polling metadata

#### Scenario: Wait timeout handling
- **WHEN** user runs `cz-cli runs wait RUN_ID --attempts 2` and run remains non-terminal
- **THEN** system returns `RUN_WAIT_TIMEOUT`
- **AND** exits with non-zero status by default

#### Scenario: Wait timeout with allow-timeout
- **WHEN** user runs `cz-cli runs wait RUN_ID --attempts 2 --allow-timeout`
- **THEN** system returns success payload containing timeout context and last observed detail

### Requirement: Runs log retrieval chain
The system SHALL support run log retrieval by chaining execution list and execution log calls.

#### Scenario: Get latest execution log
- **WHEN** user runs `cz-cli runs log RUN_ID_OR_TASK_NAME`
- **THEN** system first retrieves executions for `RUN_ID`
- **AND** then fetches log content for the latest execution

#### Scenario: Run has no execution records
- **WHEN** user runs `cz-cli runs log RUN_ID` and no execution exists
- **THEN** system returns `{ "error": "NO_EXECUTIONS", "message": "Run RUN_ID has no execution records yet" }`

### Requirement: Runs stop requires confirmation
The system SHALL require second confirmation for stopping task instances unless `-y` is provided.

#### Scenario: Stop confirmation prompt
- **WHEN** user runs `cz-cli runs stop RUN_ID_OR_TASK_NAME` without `-y`
- **THEN** CLI prompts for confirmation before stop execution

#### Scenario: Stop with force flag
- **WHEN** user runs `cz-cli runs stop RUN_ID_OR_TASK_NAME -y`
- **THEN** CLI skips prompt and executes directly

### Requirement: Schema-driven runs command validation
The system SHALL validate runs command payloads against MCP Tool `inputSchema` before invocation.

#### Scenario: Missing required field after normalization
- **WHEN** normalized payload misses any required field
- **THEN** system returns `{ "error": "INVALID_ARGUMENTS", "message": "<missing_required_fields>" }`
- **AND** does not call downstream API

#### Scenario: Unknown field with strict schema
- **WHEN** payload contains unknown field and tool schema has `additionalProperties=false`
- **THEN** system rejects request before tool invocation

### Requirement: Task-name run resolution consistency
The system SHALL use one shared resolution strategy for all commands that accept `run_id_or_task_name`.

#### Scenario: Resolve latest run across run types
- **WHEN** user passes a task name to `runs detail`/`runs log`/`runs stop`/`executions list`/`executions log`
- **THEN** system searches latest run across `task_run_type` in `{1,3,4}`
- **AND** selects the newest run by execution/trigger/planned timestamp

#### Scenario: No run found for task name
- **WHEN** task exists but no run is found in the configured time window
- **THEN** system returns `RUN_NOT_FOUND` with explicit time-window hint

### Requirement: Execution command semantics
The system SHALL expose execution operations with run-first semantics.

#### Scenario: executions list without parameter
- **WHEN** user runs `cz-cli executions list` without `run_id_or_task_name`
- **THEN** system auto-derives latest run in current project
- **AND** returns execution list with `ai_message` explaining the auto-selected run_id

#### Scenario: executions log without explicit execution_id
- **WHEN** user runs `cz-cli executions log RUN_ID_OR_TASK_NAME` without `--execution-id`
- **THEN** system first lists executions and reads logs from latest execution

#### Scenario: list_executions returns null data
- **WHEN** Studio API returns `code=200` with `data=null` for execution list
- **THEN** system treats it as empty execution list instead of raising internal errors

#### Scenario: executions stop uses run-level semantics with confirmation
- **WHEN** user runs `cz-cli executions stop RUN_ID_OR_TASK_NAME` without `-y`
- **THEN** CLI prompts for second confirmation before invoking stop action
- **AND** on confirmation system stops the resolved `task_instance_id` (run-level stop, not direct `execution_id` stop)

### Requirement: Runs refill(backfill) submission
The system SHALL support submitting a complement(backfill) job by task ID or task name to produce refill runs.

#### Scenario: Submit refill job by task name
- **WHEN** user runs `cz-cli runs refill TASK_NAME --from <date_or_iso> --to <date_or_iso> -y`
- **THEN** system resolves task name to `schedule_task_id`
- **AND** calls backfill creation tool to submit complement job
- **AND** returns the created `backfill_task_id`

#### Scenario: Refill confirmation prompt
- **WHEN** user runs `cz-cli runs refill TASK_ID ...` without `-y`
- **THEN** CLI prompts for second confirmation before submitting complement job

#### Scenario: Refill immediate default window
- **WHEN** user runs `cz-cli runs refill TASK_ID -y` without `--from/--to`
- **THEN** system submits a one-time immediate backfill window
- **AND** request still carries required backfill date fields expected by Studio

#### Scenario: Refill time-range argument validation
- **WHEN** user runs `cz-cli runs refill TASK_ID --from <time>` without `--to` (or vice versa)
- **THEN** system rejects request with `INVALID_ARGUMENTS`
- **AND** does not invoke downstream tool

### Requirement: Canonical run identity naming normalization
The system SHALL expose canonical identity aliases to reduce ambiguity between task and run identifiers.

#### Scenario: Run list and execution list return canonical run_id
- **WHEN** user runs `cz-cli runs list` or `cz-cli executions list`
- **THEN** each returned record includes canonical `run_id`
- **AND** existing source fields (such as `task_run_id`/`task_instance_id`) remain available for compatibility

#### Scenario: Run-level operations return canonical run_id
- **WHEN** user runs `cz-cli runs detail|log|stop` or `cz-cli executions log|stop`
- **THEN** response payload includes canonical `run_id`
- **AND** original backend fields are preserved

#### Scenario: Refill result normalizes backfill_task_id to run_id
- **WHEN** user runs `cz-cli runs refill ...`
- **THEN** response includes both `backfill_task_id` and canonical `run_id`
- **AND** `run_id == backfill_task_id` for that refill submission result
