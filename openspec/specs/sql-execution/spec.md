### Requirement: SQL command help signature contract
The `sql` and async-job `status` commands SHALL match CLI help signatures.

#### Scenario: sql help signature
- **WHEN** user runs `cz-cli sql --help`
- **THEN** usage is `cz-cli sql [OPTIONS] [STATEMENT]`
- **AND** options include `--write/--with-schema/--no-truncate/-f/--file/-e/--execute/--stdin/--async/--timeout/--variable/--set/--job-profile/-N/-B`

#### Scenario: async job status help signature
- **WHEN** user runs `cz-cli status --help`
- **THEN** usage is `cz-cli status [OPTIONS] JOB_ID`
- **AND** command description is async SQL job status check

### Requirement: SQL execution modes
The system SHALL support statement, file, and stdin execution modes.

#### Scenario: Execute positional SQL
- **WHEN** user runs `cz-cli sql "SELECT 1"`
- **THEN** system executes the statement and returns result

#### Scenario: Execute SQL from file
- **WHEN** user runs `cz-cli sql -f query.sql`
- **THEN** system reads SQL from file and executes it

#### Scenario: Execute SQL from stdin
- **WHEN** user runs `echo "SELECT 1" | cz-cli sql`
- **THEN** system reads SQL from stdin and executes it

### Requirement: SQL safety and formatting controls
The system SHALL enforce write safety and support output-related controls.

#### Scenario: Write SQL requires flag
- **WHEN** user runs write SQL without `--write`
- **THEN** system rejects execution with write-protection error

#### Scenario: Dangerous DELETE/UPDATE safety
- **WHEN** user runs unsafe mutation patterns blocked by guardrails
- **THEN** system rejects execution before commit

#### Scenario: Header and batch mode
- **WHEN** user runs `cz-cli sql -N -B "SELECT 1"`
- **THEN** system outputs tabular result without header in batch-friendly format

### Requirement: Async execution and job profile
The system SHALL support async execution and job-profile lookup.

#### Scenario: Execute async SQL
- **WHEN** user runs `cz-cli sql --async "SELECT * FROM t"`
- **THEN** system submits query asynchronously and returns/polls job status data

#### Scenario: Query job profile
- **WHEN** user runs `cz-cli sql --job-profile <job_id>`
- **THEN** system returns job summary/profile details

#### Scenario: Check async job status
- **WHEN** user runs `cz-cli status <job_id>`
- **THEN** system returns current async job status payload

### Requirement: SQL parameterization and flags
The system SHALL support variable substitution and SQL flag injection.

#### Scenario: SQL variable substitution
- **WHEN** user runs `cz-cli sql --variable id=1 "SELECT * FROM t WHERE id=%(id)s"`
- **THEN** system substitutes variables using pyformat style before execution

#### Scenario: SQL set flags
- **WHEN** user runs `cz-cli sql --set cz.sql.result.row.partial.limit=200 "SELECT * FROM t"`
- **THEN** system applies provided SQL flag hints during execution
