
### Requirement: task create folder name resolution
`task create --folder` SHALL accept either an integer folder ID or a folder name string, resolving the name to an ID automatically.

#### Scenario: Create task with folder name
- **WHEN** user runs `cz-cli task create my_task --folder my_folder_name --type PYTHON`
- **THEN** system calls `list_folders` API to search for a folder with `dataFolderName == "my_folder_name"`
- **AND** resolves the matching folder's integer ID
- **AND** creates the task in that folder using the resolved ID

#### Scenario: Create task with folder ID (backward compatible)
- **WHEN** user runs `cz-cli task create my_task --folder 719034 --type PYTHON`
- **THEN** system uses `719034` directly as the folder ID without any API lookup
- **AND** creates the task in the specified folder

#### Scenario: Folder name not found
- **WHEN** user runs `cz-cli task create my_task --folder nonexistent_folder`
- **THEN** system returns error code `FOLDER_NOT_FOUND`
- **AND** error message directs user to run `cz-cli task folders` to list available folders

#### Scenario: Folder name resolution spans multiple pages
- **WHEN** the target folder exists beyond page 1 of the `list_folders` response
- **THEN** system paginates through all pages until the folder is found
- **AND** creates the task using the resolved folder ID
