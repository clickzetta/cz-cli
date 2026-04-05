
### Requirement: Task command help signature contract
The `task` command family SHALL match CLI help signatures.

#### Scenario: task group help
- **WHEN** user runs `cz-cli task --help`
- **THEN** help shows subcommands `create-folder/create/folders/list/detail/save/save-config/execute/online/offline/flow`

#### Scenario: task create help signature
- **WHEN** user runs `cz-cli task create --help`
- **THEN** usage is `cz-cli task create [OPTIONS] TASK_NAME`
- **AND** options include `--type/--folder/--description`

#### Scenario: task online/offline help signatures
- **WHEN** user runs `cz-cli task online --help` and `cz-cli task offline --help`
- **THEN** all usages require `TASK_NAME_OR_ID`
- **AND** online includes `--version` and `-y`
- **AND** offline includes `--with-downstream` and `-y`

#### Scenario: task execute help signature
- **WHEN** user runs `cz-cli task execute --help`
- **THEN** usage requires `TASK_NAME_OR_ID`
- **AND** options include `--content/-f/--file/--vc/--schema/--param/--max-wait-seconds/--poll-interval`

### Requirement: Task list pagination with AI guidance
The system SHALL support paginated task listing with default first page behavior and explicit pagination guidance.

#### Scenario: Default first page
- **WHEN** user runs `cz-cli task list` without pagination arguments
- **THEN** system queries page 1 using tool schema defaults and returns results
- **AND** response includes `ai_message` indicating only the current page is shown

#### Scenario: Manual page navigation
- **WHEN** user runs `cz-cli task list --page 2 --page-size 20`
- **THEN** system queries the specified page and page size
- **AND** response includes next-step pagination guidance in `ai_message`

#### Scenario: Task list page-size alias
- **WHEN** user runs `cz-cli task list --limit 1`
- **THEN** system treats `--limit` as alias of `--page-size`
- **AND** returns one item per page when available

### Requirement: Task creation and folder operations
The system SHALL support task folder listing/creation and task creation commands.

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

### Requirement: Task temporary execute command
The system SHALL support one-off temporary task execution without online.

#### Scenario: Execute temporary run by task name
- **WHEN** user runs `cz-cli task execute TASK_NAME`
- **THEN** system resolves task name to `task_id`
- **AND** loads task detail to derive default `task_content/default_vc/default_schema`
- **AND** invokes Studio temporary execution tool
- **AND** returns canonical `task_id` and `run_id`

#### Scenario: Execute temporary run with override content and params
- **WHEN** user runs `cz-cli task execute TASK_ID --content "<script_or_sql>" --vc VC --schema SCHEMA --param k=v`
- **THEN** system uses provided overrides and passes parsed params to execution tool
- **AND** returns execution result payload with canonical `run_id`

#### Scenario: Execute temporary run input validation
- **WHEN** execution content is empty, VC cannot be resolved, or `--param` is not `KEY=VALUE`
- **THEN** system returns `INVALID_ARGUMENTS`
- **AND** does not invoke downstream execution tool

### Requirement: Task identity and online reminder semantics
The system SHALL keep task identity explicit and remind users to online after draft-level save operations.

#### Scenario: task detail keeps canonical task_id
- **WHEN** user runs `cz-cli task detail TASK_ID_OR_NAME`
- **THEN** response includes canonical `task_id` as static task definition ID
- **AND** backend field variants remain compatible

#### Scenario: task save returns canonical task_id and online reminder
- **WHEN** user runs `cz-cli task save TASK_ID_OR_NAME ...`
- **THEN** response includes canonical `task_id`
- **AND** response contains a follow-up reminder to run `task online`

#### Scenario: task save-config returns canonical task_id and online reminder
- **WHEN** user runs `cz-cli task save-config TASK_ID_OR_NAME ...`
- **THEN** response includes canonical `task_id`
- **AND** response contains a follow-up reminder to run `task online`

### Requirement: Task online requires confirmation
The system SHALL require second confirmation for online operation unless `-y` is provided.

#### Scenario: Online confirmation prompt
- **WHEN** user runs `cz-cli task online TASK_ID_OR_NAME` without `-y`
- **THEN** CLI prompts for confirmation before invoking downstream tool

#### Scenario: Online with force flag
- **WHEN** user runs `cz-cli task online TASK_ID_OR_NAME -y`
- **THEN** CLI skips prompt and executes directly

#### Scenario: Online rejects Flow tasks
- **WHEN** user runs `cz-cli task online FLOW_TASK_ID_OR_NAME -y`
- **THEN** system rejects with `INVALID_ARGUMENTS`
- **AND** error message directs user to `cz-cli task flow submit`

### Requirement: Task offline safety controls
The system SHALL support offline and offline-with-downstream operations with explicit risk confirmation.

#### Scenario: Offline task without downstream
- **WHEN** user runs `cz-cli task offline TASK_ID_OR_NAME` and task has no downstream dependency
- **THEN** system invokes offline endpoint and returns success result

#### Scenario: Offline with downstream
- **WHEN** user runs `cz-cli task offline TASK_ID_OR_NAME --with-downstream`
- **THEN** system invokes offline-with-downstream endpoint

#### Scenario: Offline confirmation message
- **WHEN** user runs offline command without `-y`
- **THEN** CLI displays irreversible cleanup warning and asks for confirmation

#### Scenario: Offline with force flag
- **WHEN** user runs offline command with `-y`
- **THEN** CLI skips prompt and executes directly

### Requirement: Schema-driven task command validation
The system SHALL validate task command payloads against MCP Tool `inputSchema` before tool invocation.

#### Scenario: Missing required field after derivation
- **WHEN** normalized payload still misses a tool-required field
- **THEN** system returns `{ "error": "INVALID_ARGUMENTS", "message": "<missing_required_fields>" }`
- **AND** does not call downstream API

#### Scenario: Unknown field with strict schema
- **WHEN** payload contains unknown field and tool schema has `additionalProperties=false`
- **THEN** system rejects the request before tool invocation

### Requirement: Task ID/name resolution consistency
The system SHALL use one shared resolver strategy for all task commands that accept `task_id_or_name`.

#### Scenario: Exact match preferred for task name
- **WHEN** user passes task name and multiple fuzzy matches exist
- **THEN** system prefers exact task_name match
- **AND** falls back to ambiguity error only when unresolved

#### Scenario: Ambiguous task name
- **WHEN** no exact match and multiple candidates exist
- **THEN** system returns `TASK_AMBIGUOUS`
- **AND** response includes candidate `task_id/task_name` pairs for disambiguation
