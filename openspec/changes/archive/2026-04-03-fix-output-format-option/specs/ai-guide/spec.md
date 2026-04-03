## MODIFIED Requirements

### Requirement: Status command output format
The `status` command SHALL accept `--output/-o` for output format.

#### Scenario: Status with format option
- **WHEN** user runs `clickzetta status -o table`
- **THEN** system returns connection status and version info in table format

#### Scenario: Status defaults to JSON
- **WHEN** user runs `clickzetta status`
- **THEN** system returns connection status and version info in JSON format
