**Documentation Reference**: /Users/zhanglin/IdeaProjects/lakehouse_doc (lakehouse SQL、概念、python sdk等文档)

### Requirement: Schema command help signature contract
The `schema` command family SHALL match CLI help signatures.

#### Scenario: schema group help
- **WHEN** user runs `cz-cli schema --help`
- **THEN** help shows subcommands `list|describe|create|drop`

#### Scenario: schema list help signature
- **WHEN** user runs `cz-cli schema list --help`
- **THEN** usage is `cz-cli schema list [OPTIONS]`
- **AND** options include `--like` and `--limit`

#### Scenario: schema create/describe/drop help signatures
- **WHEN** user runs `cz-cli schema create|describe|drop --help`
- **THEN** each usage requires positional `NAME`

### Requirement: List schemas
The system SHALL list schemas in current workspace.

#### Scenario: List all schemas
- **WHEN** user runs `cz-cli schema list`
- **THEN** system executes `SHOW SCHEMAS` and returns schema list

#### Scenario: Filter schemas by pattern
- **WHEN** user runs `cz-cli schema list --like 'test%'`
- **THEN** system applies pattern filter

#### Scenario: Limit schema results
- **WHEN** user runs `cz-cli schema list --limit 20`
- **THEN** system limits returned rows to 20 (client-side)

### Requirement: Describe schema
The system SHALL return schema metadata and table list.

#### Scenario: Describe schema
- **WHEN** user runs `cz-cli schema describe myschema`
- **THEN** system returns schema info and tables in that schema

### Requirement: Create and drop schema
The system SHALL support schema create/drop operations.

#### Scenario: Create schema
- **WHEN** user runs `cz-cli schema create myschema`
- **THEN** system executes create schema statement

#### Scenario: Drop schema
- **WHEN** user runs `cz-cli schema drop myschema`
- **THEN** system executes drop schema statement
