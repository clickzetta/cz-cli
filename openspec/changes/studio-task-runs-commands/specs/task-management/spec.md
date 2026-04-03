## ADDED Requirements

### Requirement: Task folder navigation
The system SHALL provide a command to list Studio task folders for navigation.

#### Scenario: List root folders
- **WHEN** user runs `cz-cli task folders`
- **THEN** system returns JSON list of root-level folders with `{ folder_id, folder_name, parent_folder_id, count }` and top-level `count`

#### Scenario: List subfolders
- **WHEN** user runs `cz-cli task folders --parent FOLDER_ID`
- **THEN** system returns folders under the specified parent folder

### Requirement: Task list
The system SHALL provide a command to list tasks within a folder.

#### Scenario: List tasks in folder
- **WHEN** user runs `cz-cli task list --folder FOLDER_ID`
- **THEN** system returns JSON list of tasks with `{ task_id, task_name, task_type, status, owner, last_edit_time }` and top-level `count`

#### Scenario: List tasks with type filter
- **WHEN** user runs `cz-cli task list --folder FOLDER_ID --type SQL`
- **THEN** system returns only tasks of the specified type

#### Scenario: List tasks with name filter
- **WHEN** user runs `cz-cli task list --folder FOLDER_ID --name keyword`
- **THEN** system returns tasks whose name contains the keyword

#### Scenario: List all tasks without folder filter
- **WHEN** user runs `cz-cli task list`
- **THEN** system returns tasks across all folders (paginated, default page_size=20)

### Requirement: Task detail
The system SHALL provide a command to retrieve full task definition details.

#### Scenario: Get task detail by ID
- **WHEN** user runs `cz-cli task detail TASK_ID`
- **THEN** system returns full task detail JSON including `{ task_id, task_name, task_type, task_content, task_description, status, execute_param, param_value_list, default_schema_name, default_vc_name, created_by, created_time, updated_time }`

#### Scenario: Task not found
- **WHEN** user runs `cz-cli task detail 99999` and task does not exist
- **THEN** system returns error JSON `{ "error": "TASK_NOT_FOUND", "message": "Task 99999 not found" }`

### Requirement: Task online (publish)
The system SHALL provide a command to publish a task to the scheduling system.

#### Scenario: Publish task
- **WHEN** user runs `cz-cli task online TASK_ID`
- **THEN** system submits the task for publishing and returns `{ "success": true, "task_id": TASK_ID, "message": "Task published successfully" }`

#### Scenario: Publish specific version
- **WHEN** user runs `cz-cli task online TASK_ID --version VERSION`
- **THEN** system publishes the specified version of the task

### Requirement: Task save content
The system SHALL provide a command to save task SQL/script content.

#### Scenario: Save task content from argument
- **WHEN** user runs `cz-cli task save TASK_ID --content "SELECT 1"`
- **THEN** system saves the content and returns `{ "success": true, "task_id": TASK_ID }`

#### Scenario: Save task content from file
- **WHEN** user runs `cz-cli task save TASK_ID --file query.sql`
- **THEN** system reads the file and saves its content as the task's SQL/script

### Requirement: Task save configuration
The system SHALL provide a command to save task scheduling configuration.

#### Scenario: Save cron schedule
- **WHEN** user runs `cz-cli task save-config TASK_ID --cron "0 2 * * *"`
- **THEN** system saves the cron expression and returns `{ "success": true, "task_id": TASK_ID }`

#### Scenario: Save full configuration
- **WHEN** user runs `cz-cli task save-config TASK_ID --cron "0 2 * * *" --vc default --schema public`
- **THEN** system saves cron, vcluster, and schema configuration for the task

### Requirement: Task command required parameter semantics
The system SHALL distinguish user-required CLI inputs from tool-request-required fields for task commands.

#### Scenario: User-required parameter
- **WHEN** user runs `cz-cli task detail` without `TASK_ID`
- **THEN** CLI rejects the command before tool invocation and reports missing required argument

#### Scenario: Conditional required parameter
- **WHEN** user runs `cz-cli task save TASK_ID` without both `--content` and `--file`
- **THEN** CLI returns validation error that exactly one content source is required

#### Scenario: CLI fills tool-required defaults
- **WHEN** user runs `cz-cli task online TASK_ID` without `--version`
- **THEN** CLI resolves and fills `task_version` in the tool payload before invoking `publish_task`

#### Scenario: Final payload required check
- **WHEN** normalized payload still misses a tool `required` field
- **THEN** system returns `{ "error": "INVALID_ARGUMENTS", "message": "<missing_required_fields>" }` and does not call downstream API
