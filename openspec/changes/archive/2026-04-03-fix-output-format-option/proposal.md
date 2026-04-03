## Why

The global `--output/-o` and `--format/-f` options defined on the CLI group are only recognized when placed **before** the subcommand. When users place them after the subcommand — the natural CLI pattern — Click ignores them. The `sql` command's `-f` (`--file`) also shadows the global `-f` (`--format`), causing ambiguity. The cleanest fix is to **remove the global `-f`/`--format` alias entirely**, making `-f` unambiguous everywhere (always `--file`), and add `--output/-o` as a per-command option on every subcommand.

## What Changes

- **Remove** the global `--format/-f` alias from the CLI group — keep only `--output/-o` globally
- **Add** `--output/-o` as a local option on every subcommand so it works after the subcommand name
- Local option overrides global `ctx.obj["format"]` when provided; otherwise falls back to the global value
- `-f` now consistently means `--file` across all commands (no ambiguity)
- No changes to output formats themselves, only option availability

## Capabilities

### New Capabilities
- `per-command-output-option`: Add `--output/-o` option to every Click subcommand, allowing users to control output format at the subcommand level

### Modified Capabilities
- `sql-execution`: sql command gets `--output/-o` option; existing `-f`/`--file` preserved without conflict
- `table-management`: all table subcommands get `--output/-o` option
- `schema-management`: all schema subcommands get `--output/-o` option
- `profile-management`: all profile subcommands get `--output/-o` option
- `workspace-management`: workspace subcommands get `--output/-o` option
- `ai-guide`: status command gets `--output/-o` option

## Impact

- **Code**: `cz_cli/main.py` (remove `--format/-f` global option, add `-o` to status), `cz_cli/commands/sql.py`, `cz_cli/commands/table.py`, `cz_cli/commands/schema.py`, `cz_cli/commands/profile.py`, `cz_cli/commands/workspace.py`
- **Backward compatibility**: **BREAKING** for `cz-cli -f json ...` (global `-f` removed); users must use `-o json` instead. The sql command's `-f query.sql` is unaffected. This is a minor breaking change since `-o` has always been available as the canonical shorthand.
- **API**: No public API changes
- **Dependencies**: None
