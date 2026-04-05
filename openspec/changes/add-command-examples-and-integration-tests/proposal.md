## Why

Commands currently have no usage examples in `--help` output, `ai-guide` JSON, or generated skill docs, leaving both human users and AI agents to infer correct invocations from option descriptions alone. Additionally, the integration test suite (`tests/integration/cases/`) covers only the Studio task lifecycle, leaving core commands (sql, profile, table, schema, workspace, runs) untested end-to-end.

## What Changes

- **Add per-command `examples` metadata** to every CLI command (sql, profile, table, schema, workspace, task, runs, executions, flow) as a structured list of `{cmd, desc}` items stored alongside the Click command definition.
- **Expose examples in `--help` output** by rendering them in the Click `epilog` (or equivalent) so users see them when running `cz-cli <cmd> --help`.
- **Include examples in `ai-guide` JSON** via `guide_builder.py` — `_build_command_entry()` extracts examples from command metadata and emits an `"examples"` field per command entry.
- **Include examples in generated skill docs** — `generate_skills.py` / `render_skill_markdown()` outputs examples under each command section in `SKILL.md`.
- **Add integration test YAML cases** for sql, profile, table, schema, workspace, runs (backfill/refill and executions cases excluded per scope).

## Capabilities

### New Capabilities

- `command-examples`: Per-command example metadata stored on Click commands, rendered in `--help` epilog, `ai-guide` JSON, and generated skill docs.
- `integration-test-cases`: New YAML scenario files under `tests/integration/cases/` covering sql, profile, table, schema, workspace, and runs commands.

### Modified Capabilities

- `ai-guide`: Each command entry in `ai-guide` output gains an `"examples"` array field generated from runtime command metadata.
- `skill-document-generation`: Generated `SKILL.md` includes per-command examples sections derived from the same shared metadata source.

## Impact

- **Modified files**: all files in `cz_cli/commands/` (add examples metadata), `cz_cli/guide_builder.py` (extract and emit examples), `scripts/generate_skills.py` (no logic changes; exercises updated guide_builder).
- **New files**: `tests/integration/cases/sql_basic.yaml`, `tests/integration/cases/profile_management.yaml`, `tests/integration/cases/table_schema_workspace.yaml`, `tests/integration/cases/runs_management.yaml`.
- **No breaking changes**: examples are additive; `ai-guide` JSON gains a new optional field; `--help` output gains an epilog section.
- **Backward compatibility**: commands without examples defined will simply omit the field; no schema version bump required.
