## ADDED Requirements

### Requirement: Per-command examples metadata
Every CLI command and command group SHALL carry a structured list of usage examples attached to the Click command object.

#### Scenario: Examples attached to command object
- **WHEN** a command is defined in `cz_cli/commands/*.py`
- **THEN** the Click command object has an `examples` attribute that is a list of `{"cmd": str, "desc": str}` dicts
- **AND** examples are co-located with the command definition (not a separate registry)

#### Scenario: Commands with no examples defined
- **WHEN** a command does not define examples
- **THEN** `getattr(command, "examples", [])` returns an empty list
- **AND** no error is raised and no examples section is rendered

### Requirement: Examples visible in --help output
The system SHALL render examples in the `--help` output for every command that has examples defined.

#### Scenario: --help shows examples section
- **WHEN** user runs `cz-cli <command> --help`
- **AND** the command has examples defined
- **THEN** the help output includes an "Examples:" section at the bottom
- **AND** each example is shown with its command string and description

#### Scenario: Examples section absent when none defined
- **WHEN** user runs `cz-cli <command> --help`
- **AND** the command has no examples
- **THEN** no "Examples:" section appears in the help output

### Requirement: All command groups and leaf commands have examples
The system SHALL define examples for every non-trivial command group and every leaf command across all domains: sql, profile, table, schema, workspace, task, runs, executions, flow.

#### Scenario: task create example includes --type, --folder, --description
- **WHEN** user runs `cz-cli task create --help`
- **THEN** examples include a line resembling `cz-cli task create demo_python_task --type PYTHON --folder 0 --description "demo"`
- **AND** the example demonstrates the full required argument pattern

#### Scenario: sql command example shows basic and write usage
- **WHEN** user runs `cz-cli sql --help`
- **THEN** examples include a read query example and a `--write` flagged example

#### Scenario: profile create example shows connection options
- **WHEN** user runs `cz-cli profile create --help`
- **THEN** examples include a full profile creation with `--username`, `--instance`, `--workspace`
