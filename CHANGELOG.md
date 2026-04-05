# Changelog

All notable changes to cz-cli will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `cz_cli/skills/cz-cli/scripts/` directory added as skill binary delivery location; `build_fat_multi_platform.sh` now copies the platform binary there after each build so skills can run `cz-cli` without a separate `pip install`.
- Added **Rule 0** to `SKILL.md` and `SKILL.template.md`: AI Agents must detect an unconfigured profile before any connection command and interactively guide the user through `profile create` using the `AskUserQuestion` tool — not plain-text prompts.

### Changed
- `SKILL.template.md` top-level installation block updated: binary-first (`scripts/<platform>-<arch>/cz-cli`) with `pip3 install cz-cli -U` as fallback, removing the unconditional pip-required message.
- `.gitignore` refined: `cz_cli/skills/cz-cli/scripts/*/` ignores binary payloads while `SKILL.md` and `scripts/.gitkeep` remain trackable.
- Integration test execution order: integration test scenarios are now implemented before per-command examples to ensure examples are validated against a real environment.

### Fixed
- `cz-cli task save --file` and `--content` no longer corrupt script content before uploading to Studio. Previously, literal escape sequences such as `\n` and `\t` inside Python string literals were silently replaced with real control characters by the MCP layer, causing `SyntaxError: unterminated string literal` at Studio runtime while `py_compile` passed cleanly on the local file. The CLI now passes `replace_escaped_chars=False` to preserve content verbatim.

### Changed
- **BREAKING**: Removed global `--format/-f` option. Use `--output/-o` instead. The `-f` shorthand is now unreserved and consistently means `--file` on commands that use it (e.g., `sql -f query.sql`).
- `--output/-o` now works when placed after subcommand names (e.g., `table list -o csv`), not only before them.
- `cz-cli ai-guide` now builds command inventory dynamically from Click command metadata, replacing the hand-maintained `_AI_GUIDE` block.
- `cz_cli/skills/cz-cli/SKILL.md` is now generated from a fixed template plus dynamic command inventory, with embedded generator and CLI version markers.
- Build workflows now generate skill docs before packaging (`make build`, `make build-fat`, and fat multi-version loop).

### Added
- Added a shared metadata builder in `cz_cli/guide_builder.py` to keep `--help`, `ai-guide`, and generated skill signatures aligned.
- Added `scripts/generate_skills.py` with `--check` drift validation for generated skill docs.
- Added ai-guide length budget control and truncation metadata (`CZ_AI_GUIDE_BUDGET` override supported) to keep payload size bounded while preserving mandatory sections.

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
- `--jdbc` - JDBC connection URL
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
