## Context

Every Click command in `cz_cli/commands/` already has option `help=` strings and sometimes an `epilog=`. The `guide_builder.py` module walks the Click command tree at runtime to produce the `ai-guide` JSON and `SKILL.md`. Examples don't yet exist as a structured concept — they live only as free-text epilog on one command (`sql`).

The integration test suite has a single YAML scenario file (`studio_task_lifecycle.yaml`) exercising the Studio task/runs/executions lifecycle. No YAML scenarios exist for the core data-plane commands: sql, profile, table, schema, workspace, or runs standalone queries.

## Goals / Non-Goals

**Goals:**
- Add a first-class `examples` list to every CLI command so a single definition drives `--help`, `ai-guide`, and `SKILL.md`.
- Render examples in Click `--help` via the `epilog` field (or equivalent rich-text block).
- Emit an `"examples"` array per command entry in the `ai-guide` JSON output.
- Emit examples in the generated `SKILL.md` via `guide_builder.render_skill_markdown()`.
- Add integration test YAML scenarios for sql, profile, table, schema, workspace, and runs commands.

**Non-Goals:**
- Backfill/refill (runs refill) and executions integration tests (already implemented).
- Changing the Click version or switching to another CLI framework.
- Localizing example strings.

## Decisions

### D1: Where to store examples — Click command attribute via `@click.command(epilog=...)` vs. a side-channel dict vs. a custom Click parameter

**Decision**: Attach examples as a list of `(cmd_string, description)` tuples on the Click command object using a lightweight custom `CommandWithExamples` base class (or a simple wrapper that sets `command.examples`). This keeps examples co-located with the command definition and is accessible to `guide_builder._build_command_entry()` without any import-time side effects.

**Alternatives considered**:
- *Central registry dict*: decouples examples from commands but requires manual sync when commands are renamed/removed.
- *Docstring convention*: brittle to parse; breaks if docstring format varies.
- *Click `epilog=` only*: already used by `sql`; can't be machine-parsed to extract structured `(cmd, desc)` pairs for JSON.

### D2: Rendering in `--help`

**Decision**: Generate the `epilog` string dynamically from the examples list in a `CLIGroup`/`click.Command` subclass `make_context()` or `format_help()` override, or by setting `epilog` at decoration time from the structured list. Using the existing `epilog=` parameter is simplest — we construct it from the examples list and pass it at command definition time.

The format will be:
```
Examples:
  cz-cli task create demo_python_task --type PYTHON --folder 0 --description "demo"
    Create a Python task in root folder

  cz-cli task list --limit 10
    List first 10 tasks
```

### D3: `ai-guide` schema — per-command `"examples"` field

**Decision**: `_build_command_entry()` in `guide_builder.py` checks `getattr(command, 'examples', [])` and adds `"examples": [{"cmd": ..., "desc": ...}]` to the entry dict. The budget/trimming pipeline already has a `_drop_parameter_details` stage; examples are lower priority than usage signatures but higher than extended descriptions, so they are retained in default (non-wide) mode but can be trimmed by a new `_trim_command_examples` stage when budget is exceeded.

### D4: `SKILL.md` examples rendering

**Decision**: `_skill_inventory_markdown()` in `guide_builder.py` renders examples under each command block as a fenced code block or indented list. This stays consistent with the existing template-driven approach and requires no changes to `SKILL.template.md`.

### D5: Integration test YAML structure — one file per command group vs. combined

**Decision**: One YAML scenario file per command group (`sql_basic.yaml`, `profile_management.yaml`, `table_schema_workspace.yaml`, `runs_management.yaml`). This matches the existing `studio_task_lifecycle.yaml` pattern and allows independent execution/retry per domain.

### D6: Integration test environment variable

**Decision**: Reuse `CZ_IT_PROFILE` as the required environment variable (matching the existing scenario). SQL tests will use read-only queries (no `--write`); profile tests will create/delete a temporary profile via file manipulation (avoiding live server dependency).

## Risks / Trade-offs

- **`epilog` string length** → Long example lists push `--help` output to many lines. Mitigation: keep 2–4 examples per command; most illustrative, not exhaustive.
- **Budget trimming removes examples** → AI agents lose example context when guide is trimmed. Mitigation: examples are trimmed last, after descriptions and defaults.
- **Integration tests require live `CZ_IT_PROFILE`** → Tests are skipped/fail without credentials. Mitigation: guard with `pytest.mark.skipif` on missing env var; runner already handles `requires_env`.
- **`getattr(command, 'examples', [])` fragility** → If a command is wrapped or proxied, the attribute may be lost. Mitigation: document the convention; test `guide_builder` unit tests verify attribute presence.

## Migration Plan

1. Add `CommandWithExamples` base (or `examples` attribute convention) — no breaking change.
2. Annotate each command in `cz_cli/commands/*.py` with `examples=[...]`.
3. Update `guide_builder._build_command_entry()` to read and emit `"examples"`.
4. Update `guide_builder._skill_inventory_markdown()` to render examples.
5. Regenerate `SKILL.md` via `python scripts/generate_skills.py`.
6. Add integration YAML files; run with `pytest tests/integration/` under real credentials.
7. No rollback needed — examples attribute is additive; missing attribute gracefully returns `[]`.

## Open Questions

- None blocking. Examples content (exact strings) will be determined per-command during implementation.
