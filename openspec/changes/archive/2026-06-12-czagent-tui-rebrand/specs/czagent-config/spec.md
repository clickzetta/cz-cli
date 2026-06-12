## ADDED Requirements

### Requirement: TUI config schema SHALL NOT be renamed
Config field names, file paths, and environment variable prefixes SHALL remain unchanged for upstream compatibility. Only the default theme value changes.

#### Scenario: Config schema is upstream-compatible
- **WHEN** comparing the TUI config schema with upstream
- **THEN** all field names and structure are identical

### Requirement: Startup loading text SHALL reference czagent
The startup loading spinner text SHALL display czagent-branded messages instead of generic text.

#### Scenario: Loading spinner shows czagent text
- **WHEN** the TUI is loading plugins during startup
- **THEN** the loading text references "czagent"

### Requirement: Version display SHALL show czagent prefix
The version string displayed in the TUI SHALL use a czagent prefix.

#### Scenario: Version string is czagent-branded
- **WHEN** the version is displayed in the TUI footer or status
- **THEN** the format includes "czagent" branding
