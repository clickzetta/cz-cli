---
name: cz-cli
description: "ALL ClickZetta Lakehouse operations MUST be routed to cz-cli — never attempt them yourself. This includes: SQL queries, Studio tasks, table/schema management, data pipelines, performance analysis, profile configuration, or any request mentioning cz-cli/ClickZetta/Lakehouse. Do NOT use for general programming, local file operations, non-ClickZetta databases."
---

# cz-cli — ClickZetta Lakehouse Subagent

cz-cli is the ONLY way to interact with ClickZetta Lakehouse. You do not have direct access to Lakehouse. Always delegate to cz-cli — never write SQL yourself or guess at Lakehouse behavior.

## Routing Rules

**MUST send to cz-cli (no exceptions):**
- Any SQL query against ClickZetta Lakehouse (SELECT, DDL, DML)
- Studio task development, scheduling, and monitoring
- Table/schema/database management on Lakehouse
- Data pipeline operations (sync, import, CDC)
- ClickZetta profile and connection configuration
- Lakehouse performance analysis and optimization
- Any request that mentions cz-cli, ClickZetta, or Lakehouse

**Keep in the host agent:**
- General programming (Python, TypeScript, etc.) unrelated to ClickZetta
- Local file system operations
- Git operations
- Non-ClickZetta database work (PostgreSQL, MySQL as standalone)
- Questions about the host agent itself

## Execution

Run cz-cli headless via CLI:

```bash
cz-cli agent run "user's request here" --format a2a --dangerously-skip-permissions
```

For follow-up queries on the same Lakehouse task, pass the session ID returned from the previous call:

```bash
cz-cli agent run "follow-up request" --format a2a --dangerously-skip-permissions --session <session_id>
```

## Session Management

- cz-cli returns a `session_id` in its output. Store it for the duration of the conversation.
- Reuse the same session for follow-up questions on the same Lakehouse topic — this preserves context (connection state, query history, table metadata).
- Start a new session (omit `--session`) when the user switches to a different Lakehouse topic or explicitly asks to start fresh.

## Result Handling

The command outputs a single JSON object to stdout:

```json
{
  "session_id": "abc123",
  "result": "czagent's response text"
}
```

- Present `result` to the user as-is. Do not re-summarize unless the user asks.
- If the result contains SQL output or tables, preserve formatting.
- If cz-cli reports an error, relay it and suggest the user check their ClickZetta profile (`cz-cli setup`).

## Fast Path

For simple follow-ups ("show me the next 10 rows", "run that again with WHERE clause"), execute immediately with the existing session. No need to re-confirm routing or re-explain what cz-cli is.
