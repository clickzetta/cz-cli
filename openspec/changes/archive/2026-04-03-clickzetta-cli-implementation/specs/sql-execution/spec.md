## ADDED Requirements

### Requirement: SQL execution with safety guardrails
The system SHALL execute SQL queries with built-in safety protections.

#### Scenario: Execute read-only query
- **WHEN** user runs `clickzetta sql "SELECT * FROM orders LIMIT 10"`
- **THEN** system executes query and returns results in JSON format

#### Scenario: Execute read-only query with -e flag
- **WHEN** user runs `clickzetta sql -e "SELECT * FROM orders LIMIT 10"`
- **THEN** system executes query (short option support)

#### Scenario: Execute write query without --write flag
- **WHEN** user runs `clickzetta sql "INSERT INTO orders VALUES (1, 100)"`
- **THEN** system returns error "Write operations require --write flag"

#### Scenario: Execute dangerous DELETE without WHERE
- **WHEN** user runs `clickzetta sql --write "DELETE FROM orders"`
- **THEN** system returns error "DELETE without WHERE clause is not allowed"

### Requirement: SQL from file
The system SHALL support reading SQL from files.

#### Scenario: Execute SQL from file
- **WHEN** user runs `clickzetta sql -f query.sql` or `clickzetta sql --file query.sql`
- **THEN** system reads SQL from file and executes it

### Requirement: SQL from stdin
The system SHALL support reading SQL from stdin (pipe).

#### Scenario: Execute SQL from stdin
- **WHEN** user runs `echo "SELECT 1" | clickzetta sql --stdin`
- **THEN** system reads SQL from stdin and executes it

#### Scenario: Execute SQL from pipe without --stdin flag
- **WHEN** user runs `echo "SELECT 1" | clickzetta sql` (stdin is not a TTY)
- **THEN** system automatically reads from stdin

### Requirement: Row limit protection
The system SHALL automatically limit query results to prevent excessive data return.

#### Scenario: Query without LIMIT returns many rows
- **WHEN** user runs `clickzetta sql "SELECT * FROM large_table"` and result exceeds 100 rows
- **THEN** system executes `SET cz.sql.result.row.partial.limit=100` first and returns error "Query returns more than 100 rows. Please add LIMIT to your SQL"

#### Scenario: Query with explicit --limit
- **WHEN** user runs `clickzetta sql --limit 50 "SELECT * FROM large_table"`
- **THEN** system sets limit to 50 and truncates results if needed

### Requirement: Async SQL execution
The system SHALL support asynchronous SQL execution with automatic polling.

**Implementation Reference**: /Users/zhanglin/IdeaProjects/clickzetta-java/clickzetta-connector-python/dbt_env/executeAsyncTest.py

#### Scenario: Execute async query
- **WHEN** user runs `clickzetta sql --async "SELECT * FROM large_table LIMIT 1000"`
- **THEN** system calls cursor.execute_async(), polls with cursor.is_job_finished() every 0.5 seconds, and returns results when complete

### Requirement: Variable substitution
The system SHALL support SQL variable substitution using pyformat style.

#### Scenario: Execute query with variables
- **WHEN** user runs `clickzetta sql --variable id=1 --variable name=test "SELECT * FROM users WHERE id=%(id)s AND name='%(name)s'"`
- **THEN** system substitutes variables and executes query

### Requirement: Query timeout
The system SHALL support query timeout configuration.

#### Scenario: Execute query with timeout
- **WHEN** user runs `clickzetta sql --timeout 60 "SELECT * FROM large_table"`
- **THEN** system sets hints={'sdk.job.timeout': 60} and executes query

### Requirement: Job profile查询
The system SHALL support querying job execution profile.

#### Scenario: Get job profile
- **WHEN** user runs `clickzetta sql --job-profile <query-id>`
- **THEN** system calls conn.get_job_summary(query_id) and returns profile information

### Requirement: Query status check
The system SHALL support checking async query status.

#### Scenario: Check query status
- **WHEN** user runs `clickzetta sql status <query-id>`
- **THEN** system returns current status of the query

### Requirement: Schema information in output
The system SHALL support including table schema in query results.

#### Scenario: Query with schema information
- **WHEN** user runs `clickzetta sql --with-schema "SELECT * FROM orders LIMIT 5"`
- **THEN** system includes schema: {table, columns, indexes} in output

### Requirement: Large field truncation control
The system SHALL support controlling truncation of large TEXT/BLOB fields.

#### Scenario: Query with no truncation
- **WHEN** user runs `clickzetta sql --no-truncate "SELECT * FROM articles"`
- **THEN** system returns full content without truncating large fields
