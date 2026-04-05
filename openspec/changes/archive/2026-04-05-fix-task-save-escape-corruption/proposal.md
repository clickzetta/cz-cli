## Why

`cz-cli task save --file` and `--content` silently corrupt Python (and any text) scripts before uploading to Studio: literal escape sequences such as `\n` and `\t` inside string literals are replaced with real control characters, causing `SyntaxError: unterminated string literal` at runtime in Studio. The bug is invisible locally because `python3 -m py_compile` passes on the original file.

## What Changes

- In `cz_cli/commands/task.py`, the `task_save` command now passes `replace_escaped_chars=False` to `save_non_integration_task_content` so that file/string content is uploaded verbatim without any escape-sequence substitution.

## Capabilities

### New Capabilities
<!-- none: this is a pure bug fix with no new user-visible capability -->

### Modified Capabilities
- `task-management`: The `task save` command no longer mutates script content during upload; literal `\n`/`\r`/`\t` sequences in source files are preserved exactly as written.

## Impact

- **File changed**: `cz_cli/commands/task.py` — single-line payload change in `task_save`.
- **No breaking change**: users who relied on the old (incorrect) behavior would have been experiencing broken uploads; fixing it is always safe.
- **Backward compatibility**: `replace_escaped_chars` is an existing field understood by the MCP layer (`cz_mcp`); setting it to `False` via CLI is already supported.
- **No dependency changes**.
