## ADDED Requirements

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

### Requirement: Task detail and edit operations
The system SHALL provide task detail/content/config operations for Studio tasks.

#### Scenario: Task detail by task ID
- **WHEN** user runs `cz-cli task detail TASK_ID`
- **THEN** system returns task detail for the exact task ID

#### Scenario: Save task content
- **WHEN** user runs `cz-cli task save TASK_ID --content "SELECT 1"`
- **THEN** system saves task content and returns success result

#### Scenario: Save task schedule configuration
- **WHEN** user runs `cz-cli task save-config TASK_ID --cron "0 2 * * *"`
- **THEN** system saves scheduling configuration and returns success result

### Requirement: Task online requires confirmation
The system SHALL require second confirmation for online operations unless `-y` is provided.

#### Scenario: Online confirmation prompt
- **WHEN** user runs `cz-cli task online TASK_ID` without `-y`
- **THEN** CLI prompts for confirmation before invoking downstream tool

#### Scenario: Online with force flag
- **WHEN** user runs `cz-cli task online TASK_ID -y`
- **THEN** CLI skips prompt and executes directly

### Requirement: Task offline safety controls
The system SHALL support offline and offline-with-downstream operations with explicit risk confirmation.

#### Scenario: Offline task without downstream
- **WHEN** user runs `cz-cli task offline TASK_ID` and task has no downstream dependency
- **THEN** system invokes offline endpoint and returns success result

#### Scenario: Offline with downstream
- **WHEN** user runs `cz-cli task offline TASK_ID --with-downstream`
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
