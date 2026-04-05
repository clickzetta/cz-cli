## ADDED Requirements

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

### Requirement: Runs detail uses exact run ID
The system SHALL retrieve run detail using exact task instance ID semantics.

#### Scenario: Get run detail by run ID
- **WHEN** user runs `cz-cli runs detail RUN_ID`
- **THEN** system invokes exact instance-detail tool by `RUN_ID`
- **AND** returns detailed run metadata and status

### Requirement: Runs log retrieval chain
The system SHALL support run log retrieval by chaining execution list and execution log calls.

#### Scenario: Get latest execution log
- **WHEN** user runs `cz-cli runs log RUN_ID`
- **THEN** system first retrieves executions for `RUN_ID`
- **AND** then fetches log content for the latest execution

#### Scenario: Run has no execution records
- **WHEN** user runs `cz-cli runs log RUN_ID` and no execution exists
- **THEN** system returns `{ "error": "NO_EXECUTIONS", "message": "Run RUN_ID has no execution records yet" }`

### Requirement: Runs stop requires confirmation
The system SHALL require second confirmation for stopping task instances unless `-y` is provided.

#### Scenario: Stop confirmation prompt
- **WHEN** user runs `cz-cli runs stop RUN_ID` without `-y`
- **THEN** CLI prompts for confirmation before stop execution

#### Scenario: Stop with force flag
- **WHEN** user runs `cz-cli runs stop RUN_ID -y`
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
