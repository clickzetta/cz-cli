## ADDED Requirements

### Requirement: ai-guide command naming and entry points
The system SHALL document only two CLI entry command names: `cz-cli` and `clickzetta-cli`.

#### Scenario: ai-guide command examples
- **WHEN** AI agent reads `cz-cli ai-guide`
- **THEN** all examples use `cz-cli` or `clickzetta-cli` only

### Requirement: ai-guide includes task, runs, and flow commands
The system SHALL include Studio task/runs/flow command groups in ai-guide output.

#### Scenario: ai-guide includes task commands
- **WHEN** AI agent reads ai-guide
- **THEN** guide includes task list/detail/save/save-config/online/offline/offline-with-downstream

#### Scenario: ai-guide includes runs commands
- **WHEN** AI agent reads ai-guide
- **THEN** guide includes runs list/detail/log/stop/refill/stats

#### Scenario: ai-guide includes flow commands
- **WHEN** AI agent reads ai-guide
- **THEN** guide includes flow dag/create-node/remove-node/bind/unbind/node-detail/node-save/node-save-config/submit/instances

### Requirement: ai-guide includes pagination guidance contract
The system SHALL document default-first-page behavior and `ai_message` pagination hints for list commands.

#### Scenario: ai-guide pagination guidance
- **WHEN** AI agent reads ai-guide list command docs
- **THEN** docs state default page is first page and show how to fetch next pages with `--page` and `--page-size`

### Requirement: ai-guide includes destructive-operation confirmation contract
The system SHALL document second-confirmation behavior and `-y` bypass for destructive operations.

#### Scenario: ai-guide destructive safety rules
- **WHEN** AI agent reads ai-guide
- **THEN** docs state `online/offline/offline-with-downstream/stop/refill` require confirmation unless `-y` is set

### Requirement: SKILL.md keeps minimal command inventory
The system SHALL keep SKILL.md concise and avoid duplicating full parameter schemas.

#### Scenario: SKILL.md command listing style
- **WHEN** AI coding assistant loads skill file
- **THEN** task/runs/flow sections list command names with one-line descriptions only

### Requirement: integration scenario output readability
The system SHALL run real-environment integration scenario commands with human-friendly pretty output by default unless a step explicitly overrides output format.

#### Scenario: integration runner output defaults
- **WHEN** integration scenario step command does not specify `-o/--output`
- **THEN** runner injects `-o pretty` automatically for the step
