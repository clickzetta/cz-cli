## MODIFIED Requirements

### Requirement: SQL execution with safety guardrails
The system SHALL execute SQL queries with built-in safety protections. The sql command SHALL accept `--output/-o` for output format. The global `--format/-f` alias is removed; `-f` always means `--file`.

#### Scenario: Execute read-only query
- **WHEN** user runs `clickzetta sql "SELECT * FROM orders LIMIT 10"`
- **THEN** system executes query and returns results in JSON format

#### Scenario: Execute read-only query with -o format option
- **WHEN** user runs `clickzetta sql -o table "SELECT * FROM orders LIMIT 10"`
- **THEN** system executes query and returns results in table format

#### Scenario: sql -f always means --file
- **WHEN** user runs `clickzetta sql -f query.sql`
- **THEN** system reads SQL from file and executes it

#### Scenario: Execute write query without --write flag
- **WHEN** user runs `clickzetta sql "INSERT INTO orders VALUES (1, 100)"`
- **THEN** system returns error "Write operations require --write flag"

#### Scenario: Execute dangerous DELETE without WHERE
- **WHEN** user runs `clickzetta sql --write "DELETE FROM orders"`
- **THEN** system returns error "DELETE without WHERE clause is not allowed"

### Requirement: Query status check
The system SHALL support checking async query status. The sql status command SHALL accept `--output/-o` for output format.

#### Scenario: Check query status
- **WHEN** user runs `clickzetta sql status <query-id>`
- **THEN** system returns current status of the query

#### Scenario: Check query status with format option
- **WHEN** user runs `clickzetta sql status <query-id> -o table`
- **THEN** system returns current status of the query in table format
