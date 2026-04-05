## Context

`cz-cli task save` accepts script content either as a `--content` string or via `--file <path>`. Internally it calls `save_non_integration_task_content` through the MCP client layer (`cz_mcp`). That MCP tool has a `replace_escaped_chars` flag (default `True`) originally designed for AI-model callers that emit JSON-escaped content (e.g., `\n` as two characters `\` + `n` instead of a real newline). When the CLI reads a file with `Path.read_text()`, the content is already the literal file bytes—no additional unescaping is needed or correct. The missing `replace_escaped_chars=False` in the CLI payload caused Python string literals like `",\n  "` to be corrupted into multiline broken strings, producing `SyntaxError` on Studio execution while the original file passed `py_compile` cleanly.

## Goals / Non-Goals

**Goals:**
- `cz-cli task save --file` uploads script content byte-for-byte identical to the source file.
- `cz-cli task save --content` uploads the shell-provided string without further escape substitution.
- Existing test coverage continues to pass.

**Non-Goals:**
- Changing the default MCP behavior for AI-model callers (they still need `replace_escaped_chars=True`).
- Modifying `cz-cli task execute --file`, which has its own separate content path (already reads file verbatim and passes it to a different tool).

## Decisions

**Decision: Set `replace_escaped_chars=False` unconditionally in the CLI `task save` payload**

The CLI always receives literal text—either from a file on disk or from the shell command line. Neither source produces JSON-escaped escape sequences. Setting the flag to `False` at the CLI boundary is the correct invariant: *the CLI never needs the MCP-layer unescape pass*.

Alternatives considered:
- *Auto-detect whether content contains `\\n` patterns*: Fragile—legitimate script content may contain `\\n` for other reasons.
- *Add a `--no-unescape` flag*: Unnecessary complexity; the correct default for the CLI is always `False`.
- *Fix inside `cz_mcp`*: The MCP layer cannot distinguish CLI callers from model callers without additional coupling; fixing at the CLI boundary is cleaner and lower-risk.

## Risks / Trade-offs

- **[Risk] Users who previously worked around the bug** (e.g., by pre-escaping their scripts) will now see double-literal backslashes. → Mitigation: this is an edge case; the old behavior was always incorrect for file upload.
- **[Risk] Other CLI commands with similar patterns** may have the same bug. → `task execute --file` passes content to a different MCP tool (`execute_task_with_content`) that does not apply `replace_escaped_chars`, so it is unaffected. No other command does a file-to-MCP-content upload.
