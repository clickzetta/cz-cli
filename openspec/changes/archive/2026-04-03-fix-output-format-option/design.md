## Context

In Click, options defined on a `@click.group` are only parsed before the subcommand name. Once the subcommand is matched, only options defined on that subcommand are recognized. Currently, `--output/-o` and `--format/-f` are global options on the `cli` group. Subcommands already read the resolved format from `ctx.obj["format"]` (set by the group callback), but users cannot pass these options after the subcommand name.

The `sql` command defines `-f` as `--file`, which shadows the global `-f` (`--format`) and creates ambiguity.

All subcommands in `cz_cli/commands/` follow the same pattern: they read `fmt = ctx.obj["format"]` at the start.

## Goals / Non-Goals

**Goals:**
- Remove the global `--format/-f` alias to eliminate ambiguity with `-f`/`--file`
- Allow `--output/-o` to work when placed after any subcommand name, via a custom Group class
- Preserve existing behavior when global `-o` is placed before the subcommand
- Make `-f` unambiguous: always means `--file` on every command

**Non-Goals:**
- Adding new output formats
- Modifying the `output.py` formatter
- Changing `-f` shorthand on any command (it stays as `--file`)

## Decisions

### 1. Remove global `--format/-f`, keep only `--output/-o`

**Choice**: Remove `--format` and its `-f` shorthand from the CLI group definition in `main.py`.

**Alternative considered**: Keep both global options but document that `-f` conflicts with sql. → Rejected because the conflict is inherent and documentation won't prevent mistakes.

**Rationale**: `-f` is conventionally used for `--file` in CLI tools. Having it mean `--format` globally but `--file` on sql is confusing. Removing it makes `-f` consistently mean `--file` everywhere.

### 2. Custom Group class to auto-inject `--output/-o`

**Choice**: Create a `CLIGroup(click.Group)` subclass that automatically injects the `--output/-o` option into every command (and nested group) registered via `add_command()` or `command()`.

**Alternative considered A**: Manually add `@click.option("--output", "-o", ...)` to every leaf command. → Rejected because it's repetitive and easy to forget when adding new commands.

**Alternative considered B**: Custom Click context settings (`allow_extra_args`, `allow_interspersed_args`). → Rejected because Click still won't route those args to group-level option definitions.

**Rationale**: A custom Group class defines the option once and applies it universally. It works recursively since nested groups (`table`, `schema`, etc.) are themselves added as commands to the parent. New commands get the option automatically — no developer effort needed.

Implementation sketch:
```python
_output_option = click.option("--output", "-o", "fmt", type=click.Choice([...]), default=None,
                              help="Output format (overrides global --output)")

class CLIGroup(click.Group):
    def add_command(self, cmd, name=None):
        if isinstance(cmd, click.Group):
            # Recurse: inject into the group itself and let its own add_command
            # handle child commands when they're added
            _inject_option(cmd)
        else:
            _inject_option(cmd)
        return super().add_command(cmd, name)

def _inject_option(cmd):
    """Add --output/-o option to a command if not already present."""
    for p in cmd.params:
        if getattr(p, 'name', None) == 'fmt':
            return  # Already has an output format param (e.g., sql status)
    cmd.params = [_output_option] + cmd.params
```

Then each leaf command reads: `fmt = ctx.params.get("fmt") or ctx.obj.get("format", "json")`. Since `default=None`, a None value means the user didn't provide it, so we fall back to the global setting.

### 3. Fallback chain: local option → global ctx.obj → default "json"

**Choice**: Each command resolves format as `fmt = ctx.params.get("fmt") or ctx.obj.get("format", "json")`.

**Rationale**: Most specific wins. Subcommand-level `-o` overrides global `-o`, which overrides the default.

## Risks / Trade-offs

- **BREAKING** for `cz-cli -f json ...` — Users who used `-f` for format must switch to `-o`. This is minor: `-o` has always been available, and `-f` for format was confusing given the sql conflict.
- **Custom Group class** — Adds one small class to the codebase. It's a well-understood Click pattern and easy to maintain. All command registrations (`cli.add_command()`, `table_cmd.command()`, etc.) continue to work unchanged.
