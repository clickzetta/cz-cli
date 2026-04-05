## MODIFIED Requirements

### Requirement: AI-guide command
The system SHALL provide a structured JSON guide for AI Agents.

#### Scenario: Get AI guide
- **WHEN** user runs `cz-cli ai-guide`
- **THEN** system outputs structured JSON generated from runtime command metadata (not a hard-coded command inventory)

### Requirement: Command documentation
The system SHALL include all commands with usage examples in ai-guide.

#### Scenario: AI guide includes all commands
- **WHEN** AI agent reads ai-guide output
- **THEN** command inventory is generated from current Click command tree
- **AND** added/removed/renamed commands are reflected without manual `_AI_GUIDE` edits

#### Scenario: Every non-root subcommand includes usage signature
- **WHEN** AI agent reads `commands` from `cz-cli ai-guide`
- **THEN** every non-root command path (including group commands like `profile`, `task flow`) has a non-empty `usage`
- **AND** usage is derived from runtime Click help metadata
- **AND** every command item includes `kind` with value `group` or `command`

### Requirement: ai-guide includes Studio command signature details
The system SHALL document key Studio command signatures at the same granularity as implemented CLI options.

#### Scenario: Signatures are generated from help metadata
- **WHEN** AI agent reads ai-guide for task/runs/executions/flow commands
- **THEN** usage signatures are derived from runtime help metadata
- **AND** argument names such as `TASK_NAME_OR_ID` and `RUN_ID_OR_TASK_NAME` stay aligned with command definitions

### Requirement: SKILL.md keeps minimal command inventory
The system SHALL keep SKILL.md concise and avoid duplicating full parameter schemas.

#### Scenario: SKILL command section is generated from current command tree
- **WHEN** SKILL command inventory is produced
- **THEN** inventory lines are generated from runtime command metadata
- **AND** manually maintained duplicated command blocks are not required

## ADDED Requirements

### Requirement: AI guide length budget
The system SHALL enforce an output-length budget for ai-guide while preserving mandatory sections.

#### Scenario: ai-guide exceeds configured budget
- **WHEN** generated ai-guide content exceeds the configured budget
- **THEN** system keeps mandatory sections (command signatures, safety rules, pagination/confirmation contracts)
- **AND** system trims lower-priority verbose content (extended examples/descriptions)
- **AND** output includes machine-readable truncation metadata

### Requirement: Shared metadata source for ai-guide and skill docs
The system SHALL use one shared command metadata source to render both ai-guide and skill command inventory.

#### Scenario: command definition changes once
- **WHEN** a command option or usage string changes in Click definitions
- **THEN** ai-guide and generated skill command inventory both reflect the same updated signature
- **AND** no independent manual sync step is required

### Requirement: Per-command examples in ai-guide output
The system SHALL include per-command usage examples in the ai-guide JSON output, derived from the same structured examples metadata attached to each Click command.

#### Scenario: ai-guide includes examples for commands that have them
- **WHEN** AI agent reads `commands` from `cz-cli ai-guide`
- **THEN** each command entry that has examples defined includes an `"examples"` array
- **AND** each example item has `"cmd"` (full invocation string) and `"desc"` (short description) fields
- **AND** the examples reflect current command definitions without manual editing

#### Scenario: commands without examples omit the examples field
- **WHEN** a command has no examples defined
- **THEN** its ai-guide entry omits the `"examples"` key (or includes an empty array)
- **AND** no error is emitted

#### Scenario: budget trimming may remove examples before signatures
- **WHEN** ai-guide output exceeds the configured budget
- **THEN** per-command examples are candidates for trimming after descriptions
- **AND** usage signatures and safety rules are preserved even when examples are trimmed
