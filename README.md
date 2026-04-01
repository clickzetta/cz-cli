# cz-cli

AI-Agent-friendly command-line interface for ClickZetta Lakehouse.

## Features

- **Multiple Authentication Methods**: Profile, JDBC URL, environment variables, or command-line arguments
- **AI-Friendly**: JSON output by default, structured error messages with auto-correction hints
- **Safety Guardrails**: Write protection, dangerous operation blocking, row limits, sensitive data masking
- **Async SQL Execution**: Support for long-running queries with automatic polling
- **Rich Commands**: Profile, SQL, workspace, schema, and table management

## Installation

```bash
pip install cz-cli
```

Or install from source:

```bash
git clone <repository>
cd cz-cli
pip install -e .
```

## Quick Start

### 1. Create a Profile

```bash
cz-cli profile create dev \
  --username your_username \
  --password your_password \
  --service dev-api.clickzetta.com \
  --instance your_instance \
  --workspace your_workspace
```

### 2. Test Connection

```bash
cz-cli --profile dev status
```

### 3. Execute SQL

```bash
# Simple query
cz-cli --profile dev sql "SELECT * FROM my_table LIMIT 10"

# From file
cz-cli --profile dev sql -f query.sql

# With variables
cz-cli --profile dev sql -e "SELECT * FROM users WHERE id = %(id)s" --variable id=123

# Async execution
cz-cli --profile dev sql --async "SELECT COUNT(*) FROM large_table"
```

## Configuration

### Profile Configuration

Profiles are stored in `~/.clickzetta/profiles.toml`:

```toml
default_profile = "dev"

[profiles.dev]
username = "your_username"
password = "your_password"
service = "dev-api.clickzetta.com"
instance = "your_instance"
workspace = "your_workspace"
schema = "public"
vcluster = "default"

[profiles.prod]
username = "prod_user"
password = "prod_password"
service = "api.clickzetta.com"
instance = "prod_instance"
workspace = "prod_workspace"
schema = "public"
vcluster = "default"
```

### JDBC URL Format

```
jdbc:clickzetta://host/instance?username=user&password=pass&workspace=ws&schema=schema&virtualCluster=vc
```

Example:

```bash
cz-cli --jdbc-url "jdbc:clickzetta://dev-api.clickzetta.com/myinst?username=user&password=pass&workspace=ws" sql "SELECT 1"
```

### Environment Variables

```bash
export CZ_USERNAME=your_username
export CZ_PASSWORD=your_password
export CZ_SERVICE=dev-api.clickzetta.com
export CZ_INSTANCE=your_instance
export CZ_WORKSPACE=your_workspace
export CZ_SCHEMA=public
export CZ_VCLUSTER=default

cz-cli sql "SELECT 1"
```

## Commands

### AI Skills Installation

```bash
# Install AI skills for coding assistants (interactive)
cz-cli install-skills
```

This command provides an interactive installer to add cz-cli skills to your AI coding assistant:
- Supports Claude Code, OpenClaw, Cursor, Codex, and more
- Interactive selection of tools and skills
- Automatic installation to the correct directory

### Profile Management

```bash
# List profiles
cz-cli profile list

# Create profile
cz-cli profile create <name> --username <user> --password <pass> --instance <inst> --workspace <ws>

# Update profile
cz-cli profile update <name> <key> <value>

# Delete profile
cz-cli profile delete <name>

# Set default profile
cz-cli profile use <name>
```

### SQL Execution

```bash
# Execute SQL
cz-cli sql "SELECT * FROM table LIMIT 10"
cz-cli sql -e "SELECT 1"
cz-cli sql -f query.sql

# Write operations (require --write flag)
cz-cli sql --write "INSERT INTO table VALUES (1, 'test')"

# Async execution
cz-cli sql --async "SELECT COUNT(*) FROM large_table"

# With timeout
cz-cli sql --timeout 60 "SELECT * FROM table"

# With variables (pyformat style)
cz-cli sql -e "SELECT * FROM users WHERE id = %(id)s" --variable id=123

# Set ClickZetta SQL flags
cz-cli sql --set cz.sql.result.row.partial.limit=200 "SELECT * FROM large_table"
cz-cli sql --set sdk.job.timeout=60 --set cz.sql.adhoc.result.type=ARROW "SELECT * FROM table"

# Get job profile
cz-cli sql --job-profile <job_id>

# Check job status
cz-cli sql status <job_id>

# Short options
cz-cli sql -e "SELECT 1"  # --execute
cz-cli sql -f query.sql   # --file
cz-cli sql -N "SELECT 1"  # --no-header
cz-cli sql -B "SELECT 1"  # --batch (tab-separated)
```

### Workspace Management

```bash
# Show current workspace
cz-cli workspace current

# Switch workspace
cz-cli workspace use <name>

# Switch and persist to profile
cz-cli workspace use <name> --persist
```

### Schema Management

```bash
# List schemas
cz-cli schema list
cz-cli schema list --like 'test%'

# Describe schema
cz-cli schema describe <name>

# Create schema
cz-cli schema create <name>

# Drop schema
cz-cli schema drop <name>
```

### Table Management

```bash
# List tables
cz-cli table list
cz-cli table list --schema public
cz-cli table list --like 'user%'

# Describe table
cz-cli table describe <name>

# Preview data
cz-cli table preview <name>
cz-cli table preview <name> --limit 20

# Table statistics
cz-cli table stats <name>

# Table history (including deleted)
cz-cli table history
cz-cli table history <name>

# Create table
cz-cli table create "CREATE TABLE test (id INT, name STRING)"
cz-cli table create --from-file schema.sql

# Drop table
cz-cli table drop <name>
```

## Global Options

```bash
--profile, -p       Profile name
--jdbc-url          JDBC connection URL
--schema, -s        Default schema
--vcluster, -v      Virtual cluster
--output, -o        Output format (json|table|csv|text|toon)
--format, -f        Output format (alias for --output)
--debug, -d         Enable debug mode
--silent            Suppress non-essential output
--verbose           Verbose output
```

## Safety Features

### Write Protection

Write operations (INSERT, UPDATE, DELETE, etc.) require the `--write` flag:

```bash
cz-cli sql --write "DELETE FROM table WHERE id = 1"
```

### Dangerous Operation Blocking

DELETE/UPDATE without WHERE clause are blocked:

```bash
# This will be rejected
cz-cli sql --write "DELETE FROM table"

# This is allowed
cz-cli sql --write "DELETE FROM table WHERE id = 1"
```

### Row Limit Protection

Queries without LIMIT are automatically limited to 100 rows via `SET cz.sql.result.row.partial.limit=100`.

### Sensitive Data Masking

Sensitive fields are automatically masked in output:
- Phone numbers: `138****5678`
- Emails: `u***@example.com`
- Passwords: `******`
- ID cards: `110****1234`

### Operation Logging

All operations are logged to `~/.clickzetta/sql-history.jsonl` with sensitive data redacted.

## Error Auto-Correction

When errors occur, the CLI provides helpful hints:

```json
{
  "ok": false,
  "error": {
    "code": "SQL_ERROR",
    "message": "Column 'name' not found",
    "schema": {
      "table": "users",
      "columns": ["id", "username", "email", "created_at"]
    }
  }
}
```

## Output Formats

### JSON (default)

```bash
cz-cli sql "SELECT * FROM users LIMIT 2"
```

```json
{
  "ok": true,
  "columns": ["id", "name", "email"],
  "rows": [
    {"id": 1, "name": "Alice", "email": "alice@example.com"},
    {"id": 2, "name": "Bob", "email": "bob@example.com"}
  ],
  "count": 2,
  "affected": 0,
  "time_ms": 123,
  "job_id": "2026033120245406019496708"
}
```

### TOON (LLM-optimized)

```bash
cz-cli --output toon sql "SELECT * FROM users LIMIT 2"
```

```
ok: true
columns[2]: id,name,email
rows[2]{id,name,email}:
  1,Alice,alice@example.com
  2,Bob,bob@example.com
count: 2
affected: 0
time_ms: 123
job_id: "2026033120245406019496708"
```

TOON (Token-Oriented Object Notation) achieves **30-60% fewer tokens** than JSON, making it ideal for LLM contexts.

### Table

```bash
cz-cli --output table sql "SELECT * FROM users LIMIT 2"
```

```
+----+-------+-------------------+
| id | name  | email             |
+----+-------+-------------------+
|  1 | Alice | alice@example.com |
|  2 | Bob   | bob@example.com   |
+----+-------+-------------------+
```

### CSV

```bash
cz-cli --output csv sql "SELECT * FROM users LIMIT 2"
```

```
id,name,email
1,Alice,alice@example.com
2,Bob,bob@example.com
```

## AI Agent Guide

Get structured usage guide for AI agents:

```bash
cz-cli ai-guide
```

This outputs a comprehensive JSON guide with all commands, safety rules, and examples.

## Development

### Run Tests

```bash
pytest tests/
```

### Install Development Dependencies

```bash
pip install -e ".[dev]"
```

## License

[Your License Here]

## Support

For issues and questions, please visit [repository URL].
