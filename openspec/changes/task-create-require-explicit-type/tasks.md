## 1. Task Create Contract Update

- [ ] 1.1 Change `cz-cli task create --type` from defaulted option to required option in `cz_cli/commands/task.py`
- [ ] 1.2 Keep existing task type parsing behavior (`SQL/PYTHON/SHELL/SPARK/FLOW` and integer code) unchanged
- [ ] 1.3 Update task-create help/guidance text to state explicit `--type` requirement

## 2. Agent Guidance and Documentation

- [ ] 2.1 Update `cz_cli/SKILL.template.md` to require explicit `--type` for task creation
- [ ] 2.2 Regenerate/update `cz_cli/skills/cz-cli/SKILL.md` so generated skill output matches the new task-create contract
- [ ] 2.3 Update `CHANGELOG.md` with the behavior change and compatibility note (callers must pass `--type`)

## 3. Verification

- [ ] 3.1 Add/adjust unit tests for successful typed creation path and missing-`--type` failure path in `tests/test_task_create_commands.py`
- [ ] 3.2 Verify missing-`--type` path does not invoke downstream `create_task` API in tests
- [ ] 3.3 Run targeted tests and lint (`pytest -q tests/test_task_create_commands.py` and `make lint`)
