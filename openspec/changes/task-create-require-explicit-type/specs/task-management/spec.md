## MODIFIED Requirements

### Requirement: Task creation and folder operations
The system SHALL support task folder listing/creation and task creation commands with explicit task type selection.

#### Scenario: List folders
- **WHEN** user runs `cz-cli task folders --parent 0 --page 1 --page-size 10`
- **THEN** system returns folder list and pagination metadata

#### Scenario: Create folder
- **WHEN** user runs `cz-cli task create-folder my_folder --parent 0`
- **THEN** system invokes `create_folder` handler and returns created folder metadata

#### Scenario: Create task by type with folder ID
- **WHEN** user runs `cz-cli task create my_task --type PYTHON --folder 719034`
- **THEN** system maps type enum/code and creates the task in the folder specified by integer ID

#### Scenario: Create task by type with folder name
- **WHEN** user runs `cz-cli task create my_task --type PYTHON --folder my_folder_name`
- **THEN** system resolves the folder name to its integer ID via `list_folders` API
- **AND** creates the task in the matching folder

#### Scenario: Create task rejects missing explicit type
- **WHEN** user runs `cz-cli task create my_task --folder 719034` without `--type`
- **THEN** CLI fails with a usage error indicating missing required option `--type`
- **AND** system SHALL NOT invoke downstream `create_task` API
