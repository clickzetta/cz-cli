## Why

`cz-cli task create` currently defaults to SQL when `--type` is omitted. In AI-agent flows, this causes silent mis-creation (for example, intended Python tasks become SQL tasks) and the error is discovered only later when saving or running content.

Requiring explicit task type removes this ambiguity and makes task creation deterministic for both human users and agents.

## What Changes

- Change `cz-cli task create` so `--type` is required instead of defaulting to `SQL`.
- Keep accepted type values unchanged (`SQL/PYTHON/SHELL/SPARK/FLOW` or integer code).
- Ensure missing `--type` fails fast with a clear usage error before any downstream create API call.
- Update task-create help/agent guidance text to emphasize explicit type selection.
- Add regression tests for the missing-`--type` path and normal typed creation path.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `task-management`: task creation contract changes from implicit default type to explicit required type.

## Impact

- Affected code: `cz_cli/commands/task.py`, task-create tests, and generated/templated skill guidance.
- API/tooling impact: no backend API schema change; only CLI-side argument contract and validation behavior changes.
- Compatibility: callers that omitted `--type` will now fail with usage error and must add explicit type.
