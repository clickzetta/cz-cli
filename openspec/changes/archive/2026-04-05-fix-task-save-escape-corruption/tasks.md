## 1. Bug Fix

- [x] 1.1 Add `replace_escaped_chars: False` to the `save_non_integration_task_content` payload in `task_save` (`cz_cli/commands/task.py` line 302)

## 2. Tests

- [x] 2.1 Add test: `task save --file` with a script containing `\n` inside a string literal uploads content unchanged
- [x] 2.2 Add test: `task save --content` with a string containing `\n` uploads content unchanged
- [x] 2.3 Run `make test` to confirm all existing tests still pass

## 3. Lint & Changelog

- [x] 3.1 Run `make lint` and fix any issues
- [x] 3.2 Update `CHANGELOG.md` with a `Fixed` entry describing the escape-sequence corruption bug
