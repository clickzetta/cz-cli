## 1. Integration Test — sql

- [ ] 1.1 Create `tests/integration/cases/sql_basic.yaml` with steps: read query `SELECT 1` (expect ok=true, data exists), write blocked without `--write` (expect ok=false)

## 2. Integration Test — profile

- [ ] 2.1 Create `tests/integration/cases/profile_management.yaml` with steps: `profile list` (expect ok=true, data non-empty), `profile show <env_profile>` (expect ok=true, name field present)

## 3. Integration Test — table and schema

- [ ] 3.1 Create `tests/integration/cases/table_schema_workspace.yaml` with steps: `schema list` (expect ok=true), `table list --schema <default_schema>` (expect ok=true), `workspace current` (expect ok=true)

## 4. Integration Test — runs

- [ ] 4.1 Create `tests/integration/cases/runs_management.yaml` with steps: `runs list --limit 1` (expect ok=true, pagination.page exists)

## 5. Examples Infrastructure

- [ ] 5.1 Add `examples` attribute convention to Click commands: define a helper `set_examples(cmd, examples)` utility (or use `cmd.examples = [...]` directly after decoration) in a shared location (e.g., `cz_cli/command_meta.py`) so guide_builder can read `getattr(command, "examples", [])` reliably
- [ ] 5.2 Update `guide_builder._build_command_entry()` to read `getattr(command, "examples", [])` and emit `"examples": [{"cmd": ..., "desc": ...}]` in the command entry dict when non-empty
- [ ] 5.3 Add a `_trim_command_examples` budget stage in `guide_builder._apply_budget()` that removes per-command `examples` fields when budget is exceeded (lower priority than usage signatures, higher than descriptions)
- [ ] 5.4 Update `guide_builder._skill_inventory_markdown()` to render an "Examples" subsection under each command block when examples are present (code block or indented list format)
- [ ] 5.5 Write unit tests in `tests/test_guide_builder.py` verifying: (a) examples field emitted when present, (b) examples field absent when not defined, (c) budget trimming removes examples before signatures

## 6. Add Examples to sql Command

- [ ] 6.1 Annotate `cz_cli/commands/sql.py` `sql_cmd` with examples covering: basic SELECT, SELECT with `--profile`, INSERT with `--write`, read from `--file`, async execution with `--async`
- [ ] 6.2 Update or replace the existing free-text `epilog=` on `sql_cmd` to render from the structured examples list so `--help` shows the Examples section

## 7. Add Examples to profile Commands

- [ ] 7.1 Annotate `profile create` with examples: full creation with `--username --instance --workspace`, creation from `--jdbc` URL
- [ ] 7.2 Annotate `profile list`, `profile show`, `profile update`, `profile delete`, `profile use` with representative examples
- [ ] 7.3 Annotate the `profile` group command itself with a brief overview example

## 8. Add Examples to table and schema Commands

- [ ] 8.1 Annotate `schema list` and `schema describe` (if present) with examples
- [ ] 8.2 Annotate `table list`, `table describe`, `table drop` (if present) with examples covering `--schema` flag usage

## 9. Add Examples to workspace Commands

- [ ] 9.1 Annotate `workspace current` and `workspace use` with examples (including `--persist` flag)

## 10. Add Examples to task Commands

- [ ] 10.1 Annotate `task create` with the canonical example: `cz-cli task create demo_python_task --type PYTHON --folder 0 --description "demo"` plus SQL and SHELL variants
- [ ] 10.2 Annotate `task list`, `task detail`, `task save`, `task save-config`, `task execute`, `task online`, `task offline`, `task delete`, `task folders`, `task create-folder` with examples
- [ ] 10.3 Annotate the `task` group command with an overview example

## 11. Add Examples to runs Commands

- [ ] 11.1 Annotate `runs list` with examples covering `--task`, `--run-type`, `--limit` options
- [ ] 11.2 Annotate `runs detail`, `runs log`, `runs stop`, `runs refill` with examples

## 12. Add Examples to executions Commands

- [ ] 12.1 Annotate `executions list`, `executions log`, `executions stop` with examples

## 13. Regenerate Skill Docs and Verify

- [ ] 13.1 Run `python scripts/generate_skills.py` to regenerate `cz_cli/skills/cz-cli/SKILL.md` with examples
- [ ] 13.2 Run `python scripts/generate_skills.py --check` to confirm zero drift after regeneration
- [ ] 13.3 Run `make lint` and fix any ruff violations introduced by example strings or new utility code

## 14. Final Verification

- [ ] 14.1 Run `make test` (unit tests) and confirm all pass
- [ ] 14.2 Run `make lint` and confirm zero violations
- [ ] 14.3 Manually verify `cz-cli task create --help` shows the Examples section with the `--type PYTHON --folder 0` example
- [ ] 14.4 Manually verify `cz-cli ai-guide` JSON includes `"examples"` arrays under task/sql/profile commands
- [ ] 14.5 Update `CHANGELOG.md` with entry: "Add per-command usage examples to --help, ai-guide, and SKILL.md; add integration test scenarios for sql, profile, table/schema/workspace, and runs"
