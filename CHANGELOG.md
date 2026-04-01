# Changelog

All notable changes to cz-cli will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-03-31

### Changed
- **BREAKING**: Renamed package from `clickzetta-cli` to `cz-cli`
- **BREAKING**: Renamed command from `clickzetta` to `cz-cli`
- **BREAKING**: Renamed Python module from `clickzetta_cli` to `cz_cli`
- Configuration directory remains `~/.clickzetta/` for ecosystem compatibility

### Added

#### Core Features
- Initial release of cz-cli
- AI-Agent-friendly CLI for ClickZetta Lakehouse
- Multiple authentication methods: Profile, JDBC URL, environment variables, CLI arguments
- JSON output by default for AI agent compatibility
- Count field in all list/query responses showing number of records returned

#### Profile Management
- `profile create` - Create connection profiles
- `profile list` - List all profiles
- `profile update` - Update profile fields
- `profile delete` - Delete profiles
- `profile use` - Set default profile
- Profile storage in `~/.clickzetta/profiles.toml`

#### SQL Execution
- `sql` - Execute SQL queries with safety guardrails
- Async execution support with `--async` flag
- Variable substitution with `--variable` option (pyformat style)
- Timeout control with `--timeout` option
- Job profile retrieval with `--job-profile` option
- SQL flag configuration with `--set` option (e.g., `--set cz.sql.result.row.partial.limit=200`)
- `sql status` - Check async job status
- Short options: `-e`, `-f`, `-N`, `-B`
- Row limit protection (100 rows default)
- Write protection (requires `--write` flag)
- Dangerous operation blocking (DELETE/UPDATE without WHERE)
- All SQL responses include `job_id` for tracking and debugging

#### Workspace Management
- `workspace current` - Show current workspace
- `workspace use` - Switch workspace with SDK hints
- Optional profile persistence with `--persist` flag

#### Schema Management
- `schema list` - List all schemas
- `schema describe` - Show schema details
- `schema create` - Create new schema
- `schema drop` - Drop schema
- Pattern filtering with `--like` option

#### Table Management
- `table list` - List tables with filtering
- `table describe` - Show table structure
- `table preview` - Preview table data
- `table stats` - Show table statistics via job summary
- `table history` - Show table history including deleted tables
- `table create` - Create table from DDL
- `table drop` - Drop table
- Support for `--schema` and `--like` filters

#### Safety Features
- Automatic sensitive data masking (phone, email, password, ID card)
- Operation logging to `~/.clickzetta/sql-history.jsonl`
- SQL redaction in logs
- Error auto-correction with schema hints
- Row probe limit enforcement

#### Output Formats
- JSON (default)
- Table
- CSV
- Text
- TOON (Token-Oriented Object Notation) - LLM-optimized format with 30-60% fewer tokens than JSON

#### Global Options
- `--profile/-p` - Profile selection
- `--jdbc-url` - JDBC connection URL
- `--schema/-s` - Default schema
- `--vcluster/-v` - Virtual cluster
- `--output/-o` - Output format
- `--format/-f` - Output format alias
- `--debug/-d` - Debug mode
- `--silent` - Silent mode
- `--verbose` - Verbose mode

#### AI Agent Support
- `ai-guide` command - Structured JSON guide for AI agents
- `install-skills` command - Interactive installer for AI coding assistant skills
- Comprehensive command documentation
- Safety rules and best practices
- Usage examples
- Skills bundled with package for easy distribution

#### Documentation
- Comprehensive README with examples
- Installation instructions
- Configuration guide
- Command reference
- Safety features documentation

#### Testing
- Unit tests for core modules
- Test configuration and fixtures
- Connection, logger, masking, and output tests

### Technical Details
- Built with Click framework
- Uses clickzetta-connector SDK (v1.0.16+)
- Python 3.11+ support
- TOML configuration format
- Structured error handling
- Comprehensive logging

### Dependencies
- click >= 8.0
- clickzetta-connector >= 1.0.16
- loguru >= 0.7.0
- tomli >= 2.0.0 (Python < 3.11)

[0.1.0]: https://github.com/your-org/cz-cli/releases/tag/v0.1.0
