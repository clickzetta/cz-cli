---
name: czagent
description: "ALL ClickZetta Lakehouse operations MUST be routed to czagent — never attempt them yourself. This includes: SQL queries, Studio tasks, table/schema management, data pipelines, performance analysis, profile configuration, or any request mentioning czagent/ClickZetta/Lakehouse. Do NOT use for general programming, local file operations, non-ClickZetta databases."
---

# czagent — ClickZetta Lakehouse Subagent

czagent is the ONLY way to interact with ClickZetta Lakehouse. You do not have direct access to Lakehouse. Always delegate to czagent — never try to run cz-cli, write SQL yourself, or guess at Lakehouse behavior.

## Routing Rules

**MUST send to czagent (no exceptions):**
- Any SQL query against ClickZetta Lakehouse (SELECT, DDL, DML)
- Studio task development, scheduling, and monitoring
- Table/schema/database management on Lakehouse
- Data pipeline operations (sync, import, CDC)
- ClickZetta profile and connection configuration
- Lakehouse performance analysis and optimization
- Any request that mentions czagent, ClickZetta, or Lakehouse

**Keep in the host agent:**
- General programming (Python, TypeScript, etc.) unrelated to ClickZetta
- Local file system operations
- Git operations
- Non-ClickZetta database work (PostgreSQL, MySQL as standalone)
- Questions about the host agent itself

## Execution

Run czagent headless via CLI:

```bash
cz-cli agent run "user's request here" --format a2a --dangerously-skip-permissions
```

For follow-up queries on the same Lakehouse task, pass the session ID returned from the previous call:

```bash
cz-cli agent run "follow-up request" --format a2a --dangerously-skip-permissions --session <session_id>
```

## Session Management

- czagent returns a `session_id` in its output. Store it for the duration of the conversation.
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
- If czagent reports an error, relay it and suggest the user check their ClickZetta profile (`czagent profile`).

## Fast Path

For simple follow-ups ("show me the next 10 rows", "run that again with WHERE clause"), execute immediately with the existing session. No need to re-confirm routing or re-explain what czagent is.
