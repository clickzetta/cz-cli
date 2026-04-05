## ADDED Requirements

### Requirement: Integration test scenarios for sql command
The system SHALL have an integration test YAML scenario covering basic sql command usage.

#### Scenario: sql read query succeeds
- **WHEN** the integration runner executes `cz-cli sql "SELECT 1"`
- **THEN** exit code is 0
- **AND** output JSON has `ok: true`
- **AND** output JSON includes `data` with query results

#### Scenario: sql write blocked in read-only mode
- **WHEN** the integration runner executes a write statement without `--write`
- **THEN** exit code is non-zero
- **AND** output JSON has `ok: false`
- **AND** error message indicates write protection

### Requirement: Integration test scenarios for profile command
The system SHALL have an integration test YAML scenario covering profile list and show.

#### Scenario: profile list returns profiles
- **WHEN** the integration runner executes `cz-cli profile list`
- **THEN** exit code is 0
- **AND** output JSON has `ok: true`
- **AND** output contains profile entries

#### Scenario: profile show returns profile detail
- **WHEN** the integration runner executes `cz-cli profile show <profile>`
- **THEN** exit code is 0
- **AND** output JSON has `ok: true`
- **AND** output contains profile name field

### Requirement: Integration test scenarios for table and schema commands
The system SHALL have an integration test YAML scenario covering table list and schema list.

#### Scenario: schema list returns schemas
- **WHEN** the integration runner executes `cz-cli schema list`
- **THEN** exit code is 0
- **AND** output JSON has `ok: true`
- **AND** output includes at least one schema entry or empty pagination

#### Scenario: table list returns tables in a schema
- **WHEN** the integration runner executes `cz-cli table list --schema <schema>`
- **THEN** exit code is 0
- **AND** output JSON has `ok: true`
- **AND** output includes `data` or pagination fields

### Requirement: Integration test scenarios for workspace command
The system SHALL have an integration test YAML scenario covering workspace current.

#### Scenario: workspace current returns workspace info
- **WHEN** the integration runner executes `cz-cli workspace current`
- **THEN** exit code is 0
- **AND** output JSON has `ok: true`

### Requirement: Integration test scenarios for runs command
The system SHALL have an integration test YAML scenario covering runs list.

#### Scenario: runs list succeeds with pagination
- **WHEN** the integration runner executes `cz-cli runs list --limit 1`
- **THEN** exit code is 0
- **AND** output JSON has `ok: true`
- **AND** output JSON has `pagination.page`

### Requirement: Integration test YAML schema compatibility
All new integration test YAML files SHALL be compatible with the existing `tests/integration/runner.py` scenario schema.

#### Scenario: New YAML files parsed by runner without errors
- **WHEN** the runner loads a new YAML scenario file
- **THEN** it parses `scenario`, `requires_env`, `vars`, and `steps` fields successfully
- **AND** each step follows the `{name, cmd, expect}` structure accepted by the runner
