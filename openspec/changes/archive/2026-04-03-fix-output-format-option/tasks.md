## 1. Remove Global -f/--format

- [x] 1.1 Remove `--format/-f` alias from CLI group in `cz_cli/main.py` (keep only `--output/-o`)
- [x] 1.2 Update `cli()` callback to remove `fmt_alias` parameter and logic
- [x] 1.3 Update `_AI_GUIDE` dict in `main.py` to reflect `-o` as the only shorthand

## 2. Create CLIGroup with Auto-Injected --output/-o

- [x] 2.1 Create `_output_option` as a shared `click.option("--output", "-o", "fmt", ..., default=None)` in `cz_cli/main.py`
- [x] 2.2 Create `CLIGroup(click.Group)` subclass with `add_command()` override that injects `_output_option` into every command/group
- [x] 2.3 Create `_inject_option(cmd)` helper that skips commands already having a `fmt` param
- [x] 2.4 Change `cli` group decorator from `@click.group(...)` to `@CLIGroup(...)`

## 3. Update Commands to Use Fallback Chain

- [x] 3.1 Update `sql_cmd` and `sql_status_cmd` to use `fmt = ctx.params.get("fmt") or ctx.obj.get("format", "json")`
- [x] 3.2 Update `status_cmd` to use fallback chain
- [x] 3.3 Update all table subcommands in `cz_cli/commands/table.py`
- [x] 3.4 Update all schema subcommands in `cz_cli/commands/schema.py`
- [x] 3.5 Update all profile subcommands in `cz_cli/commands/profile.py`
- [x] 3.6 Update all workspace subcommands in `cz_cli/commands/workspace.py`

## 4. Testing

- [x] 4.1 Add test: `-o` works after subcommand names (e.g., `table list -o json`)
- [x] 4.2 Add test: subcommand `-o` overrides global `--output`
- [x] 4.3 Add test: global `-f json` is rejected at group level
- [x] 4.4 Add test: sql `-f` still means `--file`
- [x] 4.5 Add test: nested group commands (e.g., `table list`) get `--output/-o` via CLIGroup

## 5. Documentation & Verification

- [x] 5.1 Update CHANGELOG.md with breaking change note (global `-f` removed)
- [x] 5.2 Run `make lint` and fix any issues
- [x] 5.3 Run `make test` and ensure all tests pass
