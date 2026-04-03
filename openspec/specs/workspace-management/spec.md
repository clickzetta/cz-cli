**Note**: ClickZetta does not provide a `SHOW WORKSPACES` SQL command. Workspaces are managed through the Web UI and specified via profile configuration or JDBC URL connection parameters.

**SDK Implementation**: Workspace switching uses SDK hint `sdk.job.default.ns` with format `workspace.schema`. Parse with `split('.')[0]` for workspace, `split('.')[1]` for schema.

### Requirement: Show current workspace
The system SHALL display the current workspace name. The command SHALL accept `--output/-o` for output format.

#### Scenario: Show current workspace
- **WHEN** user runs `clickzetta workspace current`
- **THEN** system executes `SELECT current_workspace()` and returns the workspace name

#### Scenario: Show current workspace with format option
- **WHEN** user runs `clickzetta workspace current -o table`
- **THEN** system returns workspace name in table format

### Requirement: Switch workspace
The system SHALL allow switching workspace using SDK hints. The command SHALL accept `--output/-o` for output format.

#### Scenario: Use workspace
- **WHEN** user runs `clickzetta workspace use myworkspace`
- **THEN** system sets SDK hint `{'sdk.job.default.ns': 'myworkspace.schema_name'}`
- **AND** optionally updates current profile's workspace field for persistence
