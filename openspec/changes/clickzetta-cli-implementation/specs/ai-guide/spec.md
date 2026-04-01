## ADDED Requirements

### Requirement: AI-guide command
The system SHALL provide a structured JSON guide for AI Agents.

#### Scenario: Get AI guide
- **WHEN** user runs `clickzetta ai-guide`
- **THEN** system outputs complete JSON with commands, usage patterns, safety rules, examples

### Requirement: Command documentation
The system SHALL include all commands with usage examples in ai-guide.

#### Scenario: AI guide includes all commands
- **WHEN** AI agent reads ai-guide output
- **THEN** guide includes profile, sql, workspace, schema, table commands with parameters and examples

### Requirement: Safety rules documentation
The system SHALL document all safety guardrails in ai-guide.

#### Scenario: AI guide includes safety rules
- **WHEN** AI agent reads ai-guide output
- **THEN** guide includes row_protection, write_protection, masking rules with examples
