## ADDED Requirements

### Requirement: ai-guide includes task commands
The system SHALL include task management commands in the ai-guide output.

#### Scenario: ai-guide includes cz task commands
- **WHEN** AI agent runs `cz-cli ai-guide`
- **THEN** guide includes task command group with list/folders/detail/online/save/save-config entries, each with usage, parameters, and examples

### Requirement: ai-guide includes runs commands
The system SHALL include runs management commands in the ai-guide output.

#### Scenario: ai-guide includes cz runs commands
- **WHEN** AI agent runs `cz-cli ai-guide`
- **THEN** guide includes runs command group with list/detail/log/stats entries, each with usage, parameters, and examples

### Requirement: SKILL.md lists task and runs commands
The system SHALL list task and runs commands in SKILL.md with minimal descriptions.

#### Scenario: SKILL.md task section
- **WHEN** AI coding assistant loads the cz-cli skill
- **THEN** SKILL.md contains a Task Management section listing cz-cli task list/folders/detail/online/save/save-config with one-line descriptions only (no parameter schemas)

#### Scenario: SKILL.md runs section
- **WHEN** AI coding assistant loads the cz-cli skill
- **THEN** SKILL.md contains a Runs Management section listing cz-cli runs list/detail/log/stats with one-line descriptions only (no parameter schemas)
