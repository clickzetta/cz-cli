**Documentation References**:
- SHOW CATALOG TABLE: /Users/zhanglin/IdeaProjects/lakehouse_doc/show-catalog-table.md
- DESC TABLE: /Users/zhanglin/IdeaProjects/lakehouse_doc/DESCTABLE.md
- SHOW TABLES HISTORY: /Users/zhanglin/IdeaProjects/lakehouse_doc/show-tables-history.md

### Requirement: Table command help signature contract
The `table` command family SHALL match CLI help signatures.

#### Scenario: table group help
- **WHEN** user runs `cz-cli table --help`
- **THEN** help shows subcommands `list|describe|preview|stats|history|create|drop`

#### Scenario: table list/history help includes limit filters
- **WHEN** user runs `cz-cli table list --help` or `cz-cli table history --help`
- **THEN** options include `--limit`
- **AND** list includes `--like/--schema`, history includes optional `[NAME]` plus `--schema/--like`

#### Scenario: table create help signature
- **WHEN** user runs `cz-cli table create --help`
- **THEN** usage is `cz-cli table create [OPTIONS] [DDL]`
- **AND** options include `--from-file`

### Requirement: List tables
The system SHALL list tables in current or specified schema.

#### Scenario: List all tables
- **WHEN** user runs `cz-cli table list`
- **THEN** system executes table listing SQL and returns table names

#### Scenario: Filter and limit tables
- **WHEN** user runs `cz-cli table list --schema myschema --like 'order%' --limit 50`
- **THEN** system applies filters and row limit

### Requirement: Describe and preview table
The system SHALL provide table schema and data preview.

#### Scenario: Describe table
- **WHEN** user runs `cz-cli table describe orders`
- **THEN** system returns columns and metadata

#### Scenario: Preview table data
- **WHEN** user runs `cz-cli table preview orders --limit 10`
- **THEN** system returns up to the requested number of rows

### Requirement: Table stats and history
The system SHALL support stats and history queries.

#### Scenario: Table stats
- **WHEN** user runs `cz-cli table stats orders`
- **THEN** system returns row count and job summary

#### Scenario: Table history
- **WHEN** user runs `cz-cli table history orders --limit 100`
- **THEN** system returns history records (including deleted tables)

### Requirement: Create and drop table
The system SHALL support table create and drop commands.

#### Scenario: Create table with inline DDL
- **WHEN** user runs `cz-cli table create "CREATE TABLE t(a INT)"`
- **THEN** system executes provided DDL

#### Scenario: Create table from file
- **WHEN** user runs `cz-cli table create --from-file schema.sql`
- **THEN** system reads DDL from file and executes it

#### Scenario: Drop table
- **WHEN** user runs `cz-cli table drop orders`
- **THEN** system executes table drop statement
