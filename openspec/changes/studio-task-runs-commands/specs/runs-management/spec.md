## ADDED Requirements

### Requirement: Runs list
The system SHALL provide a command to list task run instances.

#### Scenario: List recent runs
- **WHEN** user runs `cz-cli runs list`
- **THEN** system returns JSON list of runs from the past 24 hours with `{ task_run_id, task_name, task_type, task_run_status, execute_start_time, execute_end_time, fail_msg }` and top-level `count`

#### Scenario: List runs for specific task
- **WHEN** user runs `cz-cli runs list --task TASK_ID`
- **THEN** system returns runs filtered to the specified task

#### Scenario: List runs with status filter
- **WHEN** user runs `cz-cli runs list --status FAILED`
- **THEN** system returns only runs with the specified status (RUNNING/SUCCESS/FAILED/WAITING)

#### Scenario: List runs with time range
- **WHEN** user runs `cz-cli runs list --from "2024-01-01 00:00" --to "2024-01-02 00:00"`
- **THEN** system returns runs within the specified plan trigger time range

### Requirement: Runs detail
The system SHALL provide a command to retrieve full details of a specific run instance.

#### Scenario: Get run detail by ID
- **WHEN** user runs `cz-cli runs detail RUN_ID`
- **THEN** system returns full run detail JSON including `{ task_run_id, task_name, task_type, task_run_status, plan_trigger_time, execute_start_time, execute_end_time, fail_type, fail_msg, task_param, vc_code, version }`

#### Scenario: Run not found
- **WHEN** user runs `cz-cli runs detail 99999` and run does not exist
- **THEN** system returns error JSON `{ "error": "RUN_NOT_FOUND", "message": "Run 99999 not found" }`

### Requirement: Runs log
The system SHALL provide a command to retrieve execution logs for a run instance.

#### Scenario: Get latest execution log
- **WHEN** user runs `cz-cli runs log RUN_ID`
- **THEN** system fetches the latest execution record for the run and returns its log content from tail

#### Scenario: Get log with offset
- **WHEN** user runs `cz-cli runs log RUN_ID --offset 2000`
- **THEN** system returns log content starting from the specified byte offset (downward direction)

#### Scenario: Run has no executions
- **WHEN** user runs `cz-cli runs log RUN_ID` and the run has no execution records
- **THEN** system returns `{ "error": "NO_EXECUTIONS", "message": "Run RUN_ID has no execution records yet" }`

### Requirement: Runs stats
The system SHALL provide a command to retrieve aggregated run statistics.

#### Scenario: Get today's run statistics
- **WHEN** user runs `cz-cli runs stats`
- **THEN** system returns aggregated counts by status for today's runs: `{ "date": "2024-01-01", "total": N, "by_status": { "SUCCESS": N, "FAILED": N, "RUNNING": N, "WAITING": N }, "count": N }`

#### Scenario: Get stats for specific task
- **WHEN** user runs `cz-cli runs stats --task TASK_NAME`
- **THEN** system returns statistics filtered to runs matching the task name

#### Scenario: Get stats for time range
- **WHEN** user runs `cz-cli runs stats --from "2024-01-01" --to "2024-01-07"`
- **THEN** system returns aggregated statistics for the specified date range

### Requirement: Runs command required parameter semantics
The system SHALL distinguish user-required CLI inputs from tool-request-required fields for runs commands.

#### Scenario: CLI fills tool-required defaults for runs list
- **WHEN** user runs `cz-cli runs list` without paging/time arguments
- **THEN** CLI fills `page_index`, `page_size`, `query_plan_time_left`, and `query_plan_time_right` defaults before invoking `list_task_run`

#### Scenario: User-required parameter
- **WHEN** user runs `cz-cli runs detail` without `RUN_ID`
- **THEN** CLI rejects the command before tool invocation and reports missing required argument

#### Scenario: Conditional required parameter
- **WHEN** user runs `cz-cli runs log RUN_ID --offset 2000`
- **THEN** CLI switches to downward log mode and sends payload compatible with `get_execution_log` requirements

#### Scenario: Final payload required check
- **WHEN** normalized payload still misses a tool `required` field
- **THEN** system returns `{ "error": "INVALID_ARGUMENTS", "message": "<missing_required_fields>" }` and does not call downstream API
