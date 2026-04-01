---
name: cz-cli
description: "ClickZetta CLI reference - AI-Agent-friendly command-line interface for ClickZetta Lakehouse with comprehensive command documentation, usage examples, and best practices"
license: Apache-2.0
---

# cz-cli Skill

This skill provides comprehensive reference documentation for the cz-cli tool, an AI-Agent-friendly command-line interface for ClickZetta Lakehouse.

## When to Use This Skill

Use this skill when you need to:
- Execute SQL queries against ClickZetta Lakehouse
- Manage database schemas, tables, and workspaces
- Configure connection profiles
- Work with ClickZetta data programmatically
- Understand cz-cli command syntax and options

## Available Commands

### Profile Management (First Operation)
- `cz-cli profile create` - Create connection profiles
- `cz-cli profile list` - List all profiles
- `cz-cli profile use` - Set default profile
- `cz-cli profile update` - Update profile fields
- `cz-cli profile delete` - Delete profiles

### SQL Execution
- `cz-cli sql` - Execute SQL queries with safety guardrails
- `cz-cli sql --async` - Async execution with auto-polling
- `cz-cli sql --set` - Set ClickZetta SQL flags
- `cz-cli sql --variable` - Variable substitution
- `cz-cli sql status` - Check async job status

### Workspace Management
- `cz-cli workspace current` - Show current workspace
- `cz-cli workspace use` - Switch workspace

### Schema Management
- `cz-cli schema list` - List all schemas
- `cz-cli schema describe` - Show schema details
- `cz-cli schema create` - Create new schema
- `cz-cli schema drop` - Drop schema

### Table Management
- `cz-cli table list` - List tables with filtering
- `cz-cli table describe` - Show table structure
- `cz-cli table preview` - Preview table data
- `cz-cli table stats` - Show table statistics
- `cz-cli table history` - Show table history
- `cz-cli table create` - Create table from DDL
- `cz-cli table drop` - Drop table

## Safety Features

### Write Protection
Write operations (INSERT, UPDATE, DELETE) require the `--write` flag:
```bash
cz-cli sql --write "DELETE FROM table WHERE id = 1"
```

### Dangerous Operation Blocking
DELETE/UPDATE without WHERE clause are blocked:
```bash
# This will be rejected
cz-cli sql --write "DELETE FROM table"
```

### Row Limit Protection
Queries without LIMIT are automatically limited to 100 rows via `SET cz.sql.result.row.partial.limit=100`.

### Sensitive Data Masking
Sensitive fields are automatically masked in output:
- Phone numbers: `138****5678`
- Emails: `u***@example.com`
- Passwords: `******`
- ID cards: `110***********1234`

## Output Formats

- `json` (default) - Structured JSON output
- `table` - Human-readable table format
- `csv` - Comma-separated values
- `text` - Plain text
- `toon` - Token-Oriented Object Notation (LLM-optimized, 30-60% fewer tokens)

Example:
```bash
cz-cli --output toon sql "SELECT * FROM users LIMIT 2"
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
```

### JDBC URL Format
```
jdbc:clickzetta://host/instance?username=user&password=pass&workspace=ws&schema=schema&virtualCluster=vc
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
```

## Best Practices

1. **Always use profiles** for repeated connections instead of passing credentials via command line
2. **Use --write flag** explicitly for write operations to prevent accidental data modification
3. **Add LIMIT clauses** to SELECT queries to avoid fetching too much data
4. **Use --output toon** when working with LLMs to reduce token consumption
5. **Set SQL flags** with --set for query optimization (e.g., `--set cz.sql.result.row.partial.limit=200`)
6. **Use --async** for long-running queries to avoid blocking
7. **Check job_id** in output for tracking and debugging queries

## Common Patterns

### Quick Query
```bash
cz-cli --profile dev sql "SELECT COUNT(*) FROM my_table"
```

### Query with Variables
```bash
cz-cli sql -e "SELECT * FROM users WHERE id = %(id)s" --variable id=123
```

### Async Long Query
```bash
cz-cli sql --async "SELECT COUNT(*) FROM large_table"
```

### Custom SQL Flags
```bash
cz-cli sql --set cz.sql.result.row.partial.limit=500 "SELECT * FROM table"
```

### Export to CSV
```bash
cz-cli --output csv sql "SELECT * FROM users" > users.csv
```

## Error Handling

The CLI provides structured error messages with auto-correction hints:
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

## See Also

- [ClickZetta Documentation](https://yunqi.tech/documents)
- [cz-cli GitHub Repository](https://github.com/clickzetta/cz-cli)
