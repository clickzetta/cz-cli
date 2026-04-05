### Requirement: Subcommands accept --output/-o option
Every leaf command in cz-cli SHALL accept `--output` and `-o` options with the same choices as the global option (`json`, `pretty`, `table`, `csv`, `jsonl`, `toon`). The subcommand-level option SHALL override the global `--output` when both are provided.

#### Scenario: Output format after subcommand name
- **WHEN** user runs `cz-cli sql -o table "SELECT 1"`
- **THEN** output is rendered in table format

#### Scenario: Pretty output format
- **WHEN** user runs `cz-cli task list -o pretty`
- **THEN** output is rendered in pretty JSON format with ANSI color when terminal supports it

#### Scenario: Output format before subcommand name still works
- **WHEN** user runs `cz-cli --output table sql "SELECT 1"`
- **THEN** output is rendered in table format (global option behavior unchanged)

#### Scenario: Subcommand option overrides global option
- **WHEN** user runs `cz-cli --output json table list -o csv`
- **THEN** output is rendered in CSV format (subcommand-level takes precedence)

#### Scenario: No output option defaults to global or json
- **WHEN** user runs `cz-cli table list` without any `--output` flag
- **THEN** output defaults to the global setting, or `json` if no global setting

### Requirement: Global -f/--format alias removed
The CLI group SHALL NOT define `--format` or `-f` as a global option. The `-f` shorthand SHALL be reserved for `--file` on commands that need it (e.g., sql).

#### Scenario: Global -f rejected
- **WHEN** user runs `cz-cli -f json sql "SELECT 1"`
- **THEN** Click reports an error that `-f` is not recognized at the group level

#### Scenario: -o works globally as before
- **WHEN** user runs `cz-cli -o json sql "SELECT 1"`
- **THEN** output is rendered in JSON format

### Requirement: All subcommand groups propagate output format
Nested subcommands under `table`, `schema`, `profile`, and `workspace` groups SHALL each accept the `--output/-o` option independently.

#### Scenario: table subcommands accept -o
- **WHEN** user runs `cz-cli table list -o table`
- **THEN** output is rendered in table format

#### Scenario: schema subcommands accept -o
- **WHEN** user runs `cz-cli schema list -o csv`
- **THEN** output is rendered in CSV format

#### Scenario: profile subcommands accept -o
- **WHEN** user runs `cz-cli profile list -o json`
- **THEN** output is rendered in JSON format

#### Scenario: workspace subcommands accept -o
- **WHEN** user runs `cz-cli workspace current -o toon`
- **THEN** output is rendered in TOON format
