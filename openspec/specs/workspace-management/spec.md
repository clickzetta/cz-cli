**Note**: ClickZetta does not provide a `SHOW WORKSPACES` SQL command. Workspaces are managed by connection context and profile configuration.

### Requirement: Workspace command help signature contract
The `workspace` command family SHALL match CLI help signatures.

#### Scenario: workspace group help
- **WHEN** user runs `cz-cli workspace --help`
- **THEN** help shows subcommands `current` and `use`

#### Scenario: workspace use help signature
- **WHEN** user runs `cz-cli workspace use --help`
- **THEN** usage is `cz-cli workspace use [OPTIONS] NAME`
- **AND** options include `--schema` and `--persist`

### Requirement: Show current workspace
The system SHALL display current workspace.

#### Scenario: Show current workspace
- **WHEN** user runs `cz-cli workspace current`
- **THEN** system queries current workspace and returns `{workspace: <name>}`

### Requirement: Switch workspace hint and persistence
The system SHALL support switching workspace context with optional persistence.

#### Scenario: Use workspace without persist
- **WHEN** user runs `cz-cli workspace use myworkspace`
- **THEN** system returns SDK hint guidance for `sdk.job.default.ns`
- **AND** profile file is not modified

#### Scenario: Use workspace with persist
- **WHEN** user runs `cz-cli workspace use myworkspace --schema public --persist`
- **THEN** system updates profile workspace/schema in `~/.clickzetta/profiles.toml`
