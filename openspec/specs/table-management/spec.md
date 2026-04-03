**Documentation References**:
- SHOW CATALOG TABLE: /Users/zhanglin/IdeaProjects/lakehouse_doc/show-catalog-table.md
- DESC TABLE: /Users/zhanglin/IdeaProjects/lakehouse_doc/DESCTABLE.md
- SHOW TABLES HISTORY: /Users/zhanglin/IdeaProjects/lakehouse_doc/show-tables-history.md

### Requirement: List tables
The system SHALL list all tables with filtering options using SHOW CATALOG TABLE syntax. The command SHALL accept `--output/-o` for output format.

#### Scenario: List all tables
- **WHEN** user runs `clickzetta table list`
- **THEN** system executes SHOW CATALOG TABLE and returns table list

#### Scenario: List tables with output format
- **WHEN** user runs `clickzetta table list -o csv`
- **THEN** system returns table list in CSV format

#### Scenario: Filter tables by pattern
- **WHEN** user runs `clickzetta table list --like 'order%'`
- **THEN** system executes SHOW CATALOG TABLE LIKE 'order%' and returns matching tables

#### Scenario: Filter tables by schema
- **WHEN** user runs `clickzetta table list --schema myschema`
- **THEN** system returns only tables in specified schema

### Requirement: Describe table
The system SHALL show table structure using DESC TABLE syntax. The command SHALL accept `--output/-o` for output format.

#### Scenario: Describe table
- **WHEN** user runs `clickzetta table describe orders`
- **THEN** system executes DESC TABLE orders and returns column definitions with types and comments

### Requirement: Preview table data
The system SHALL show sample rows from a table. The command SHALL accept `--output/-o` for output format.

#### Scenario: Preview with default limit
- **WHEN** user runs `clickzetta table preview orders`
- **THEN** system executes SELECT * FROM catalog_name.schema_name.orders LIMIT 10

#### Scenario: Preview with custom limit
- **WHEN** user runs `clickzetta table preview orders --limit 50`
- **THEN** system executes SELECT * FROM catalog_name.schema_name.orders LIMIT 50

### Requirement: Table statistics
The system SHALL show table statistics using SDK job summary. The command SHALL accept `--output/-o` for output format.

#### Scenario: Get table stats
- **WHEN** user runs `clickzetta table stats orders`
- **THEN** system executes query and calls conn.get_job_summary(cursor.job_id) to return row count, data size, partition info

### Requirement: Table history
The system SHALL show table change history using SHOW TABLES HISTORY syntax. The command SHALL accept `--output/-o` for output format.

#### Scenario: Get table history
- **WHEN** user runs `clickzetta table history orders`
- **THEN** system executes SHOW TABLES HISTORY and returns historical snapshots

### Requirement: Create table
The system SHALL create tables from DDL. The command SHALL accept `--output/-o` for output format.

#### Scenario: Create table with inline DDL
- **WHEN** user runs `clickzetta table create orders "CREATE TABLE orders (id INT, name VARCHAR(100))"`
- **THEN** system executes CREATE TABLE statement

#### Scenario: Create table from file
- **WHEN** user runs `clickzetta table create orders --from-file schema.sql`
- **THEN** system reads DDL from file and executes CREATE TABLE

### Requirement: Drop table
The system SHALL drop tables. The command SHALL accept `--output/-o` for output format.

#### Scenario: Drop table
- **WHEN** user runs `clickzetta table drop orders`
- **THEN** system executes DROP TABLE orders
