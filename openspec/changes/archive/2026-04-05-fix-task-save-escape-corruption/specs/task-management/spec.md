## MODIFIED Requirements

### Requirement: Task detail and edit operations
The system SHALL provide task detail/content/config operations for Studio tasks.

#### Scenario: Task detail by task ID
- **WHEN** user runs `cz-cli task detail TASK_ID`
- **THEN** system returns task detail for the exact task ID

#### Scenario: Task detail by task name
- **WHEN** user runs `cz-cli task detail TASK_NAME`
- **THEN** system resolves task name to task_id and returns detail

#### Scenario: Save task content
- **WHEN** user runs `cz-cli task save TASK_ID_OR_NAME --content "SELECT 1"`
- **THEN** system saves task content verbatim and returns success result
- **AND** escape sequences such as `\n` or `\t` in the provided string SHALL NOT be substituted with real control characters

#### Scenario: Save task content from file with short option
- **WHEN** user runs `cz-cli task save TASK_ID_OR_NAME -f task.py`
- **THEN** system reads file content and saves it to the target task byte-for-byte identical to the source file
- **AND** escape sequences such as `\n` or `\t` inside string literals in the file SHALL NOT be substituted with real control characters

#### Scenario: Save task content from file preserves Python string literals
- **WHEN** a Python script contains a string literal such as `",\n  ".join(...)`
- **AND** user runs `cz-cli task save TASK_ID_OR_NAME -f script.py`
- **THEN** the script uploaded to Studio SHALL be syntactically identical to the local file
- **AND** executing the task in Studio SHALL NOT raise `SyntaxError`

#### Scenario: Save task schedule configuration
- **WHEN** user runs `cz-cli task save-config TASK_ID_OR_NAME --cron "0 2 * * *"`
- **THEN** system saves scheduling configuration and returns success result
