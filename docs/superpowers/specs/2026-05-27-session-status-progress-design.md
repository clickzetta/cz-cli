# Session Status Progress Line — Design

## Overview

Add a single-line human-readable progress indicator to `cz-cli agent session status <sessionID>` output (when busy) or the final text result (when idle), so external host agents (like Claude Code) can know what cz-cli is currently doing through polling alone, without needing additional commands.

To ensure TTY rendering and progress rendering stay consistent when new tools are added, extract the "data computation" portion of the 12 tool-specific render functions in `run.ts` into a pure function `describePart()`, used by both the TTY path and the status path.

## Motivation

The current `agent session status` only returns `idle | busy`. The host agent cannot see "what step is currently executing." For details, it must run `agent export` to dump the entire session.

Requirements:

1. **Visible progress** — When busy, see at a glance what's happening (which tool, which command, whether it's thinking, whether it's retrying)
2. **Ready-to-use completion** — When idle, get the final text reply directly without going through `export`
3. **Future-proof** — TTY rendering and progress rendering share a single source of truth; adding a new tool won't drift between them

## Non-goals

- No SSE / streaming push (poll model is sufficient)
- No cursor-based incremental part fetch (use `export` for full data)
- No type-filter or grep on parts (use `export | jq` for complex queries)
- Don't expose the SQLite path for direct external reads (keep CLI as the stable contract)

## Design

### Data flow

```
┌──────────────────┐     ┌────────────────────────┐
│ session status   │ ──> │ Query SQLite           │
│ <sessionID>      │     │  - SessionStatus.get() │
└──────────────────┘     │  - PartTable latest    │
                         │  - PartTable last text │
                         └───────────┬────────────┘
                                     │
                          ┌──────────▼──────────┐
                          │ describePart(part)  │  pure function
                          │ → {icon, title, …}  │  shared by TTY & status
                          └──────────┬──────────┘
                                     │
                          ┌──────────▼──────────┐
                          │ progressLine()      │
                          │ → "$ cz-cli ..."    │
                          └─────────────────────┘
```

### Three core deliverables

1. **Pure renderer module** — new `render.ts` with `describePart()` and `progressLine()`
2. **Session Service helpers** — add `latestPart()` and `lastTextPart()` to `Session.Service`
3. **TTY thin-shell refactor** — `run.ts` 12 tool functions delegate to `describePart`
4. **`session status` enhancement** — handler uses the new Service helpers + `progressLine`

#### 1. `describePart()` pure function (new file `packages/opencode/src/session/render.ts`)

```typescript
export type PartDescription = {
  icon: string                  // single-character icon: "$" "→" "✱" "💭" "✏" "▶" "✓" "↻"
  title: string                 // main title, e.g. "cz-cli table list -o table"
  description?: string          // optional subtitle, e.g. "3 matches"
  output?: string               // multi-line content (bash output, todo list); TTY-only
}

export function describePart(part: MessageV2.Part): PartDescription
```

Covers all 12 part types (see Part Rendering Map below).

#### 2. TTY thin-shell refactor (modify `packages/opencode/src/cli/cmd/run.ts`)

The 12 tool-specific functions (`bash()`, `read()`, `grep()`, etc.) become:

```typescript
function bash(info: ToolProps<typeof BashTool>) {
  const d = describePart(info.part)
  block({ icon: d.icon, title: d.title, description: d.description }, d.output)
}
function read(info: ToolProps<typeof ReadTool>) {
  inline(describePart(info.part))
}
// ... all 12 functions become 2-3 lines of dispatch
```

`inline()` / `block()` themselves remain unchanged and continue to apply ANSI styling internally. ANSI does not enter `describePart`'s domain.

#### 3. `session status` enhancement (modify `packages/opencode/src/cli/cmd/session.ts`)

Two new helper queries are needed; we add them as Session Service methods (next to existing `getPart`):

```typescript
// In packages/opencode/src/session/session.ts (Service interface)
readonly latestPart: (sessionID: SessionID) => Effect.Effect<MessageV2.Part | undefined>
readonly lastTextPart: (sessionID: SessionID) => Effect.Effect<MessageV2.TextPart | undefined>
```

Implementation uses Drizzle queries on `PartTable`, ordering by `time_created DESC`, limit 1, optionally filtering `data->>'$.type' = 'text'` for `lastTextPart`. SQLite supports JSON path expressions natively, so the type filter is a single WHERE clause without app-side filtering.

Then the status command handler:

```typescript
export const SessionStatusCommand = cmd({
  command: "status <sessionID>",
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessionID = SessionID.make(args.sessionID)

      // Verify session exists
      try {
        await AppRuntime.runPromise(Session.Service.use((svc) => svc.get(sessionID)))
      } catch {
        process.stdout.write(JSON.stringify({ session_id: args.sessionID, error: "Session not found" }) + EOL)
        process.exit(1)
      }

      // Query session runtime status
      const status = await AppRuntime.runPromise(SessionStatus.Service.use((svc) => svc.get(sessionID)))

      // busy / retry: include progress line
      if (status?.type === "busy" || status?.type === "retry") {
        const latest = await AppRuntime.runPromise(
          Session.Service.use((svc) => svc.latestPart(sessionID))
        )
        const out: Record<string, unknown> = {
          session_id: args.sessionID,
          status: status.type,
        }
        if (latest) out.progress = progressLine(latest)
        if (status.type === "retry") {
          out.retry = { attempt: status.attempt, message: status.message, next: status.next }
        }
        process.stdout.write(JSON.stringify(out) + EOL)
        return
      }

      // idle: include final text reply
      const lastText = await AppRuntime.runPromise(
        Session.Service.use((svc) => svc.lastTextPart(sessionID))
      )
      process.stdout.write(JSON.stringify({
        session_id: args.sessionID,
        status: "idle",
        result: lastText?.text ?? null,
      }) + EOL)
    })
  },
})
```

### Part rendering map

| Part type | icon | title template | description | output |
|-----------|------|---------------|-------------|--------|
| `tool` bash | `$` | `${command}` | — | `state.output` (when completed) |
| `tool` read | `→` | `Read ${filePath}` | other input fields `[k=v, ...]` | — |
| `tool` write | `←` | `Write ${filePath}` | — | `state.output` |
| `tool` edit | `←` | `Edit ${filePath}` | — | `metadata.diff` |
| `tool` glob | `✱` | `Glob "${pattern}"` | `in ${path} · ${count} matches` | — |
| `tool` grep | `✱` | `Grep "${pattern}"` | `in ${path} · ${matches} matches` | — |
| `tool` webfetch | `%` | `WebFetch ${url}` | — | — |
| `tool` codesearch | `◇` | `Exa Code Search "${query}"` | — | — |
| `tool` websearch | `◈` | `Exa Web Search "${query}"` | — | — |
| `tool` task | `•`/`✗`/`✓` | `${description ?? agent + " Task"}` | `${agent} Agent` | — |
| `tool` skill | `→` | `Skill "${name}"` | — | — |
| `tool` todowrite | `#` | `Todos` | — | todo list lines |
| `tool` other | `⚙` | `${tool} ${title \|\| ""}` | — | — |
| `text` | `✏` | `Generating response...` | — | — |
| `reasoning` | `💭` | `Thinking...` | — | — |
| `step-start` | `▶` | `Calling LLM...` | — | — |
| `step-finish` | `✓` | `Step done (${reason})` | — | — |
| `retry` | `↻` | `Retry (attempt ${attempt})` | — | — |
| `compaction` | `🗜` | `Compacting context...` | — | — |
| `patch` | `±` | `Patch (${files.length} files)` | — | — |
| `snapshot` | `◷` | `Snapshot` | — | — |
| `subtask` | `◔` | `Subtask: ${description}` | — | — |
| `agent` | `@` | `Agent ${name}` | — | — |
| `file` | `📎` | `File ${filename ?? ""}` | — | — |

`progressLine()` outputs `${icon} ${title}` or `${icon} ${title} · ${description}`. The `output` field is only consumed by the TTY path's `block()`; progress always ignores it.

### Part state handling

The `tool` type has 4 states: `pending` / `running` / `completed` / `error`.

- `task` tool: icon depends on status (running=`•`, completed=`✓`, error=`✗`) — existing behavior, preserved
- Other tools: icon does not depend on status — existing behavior, preserved

`bash` in completed state puts `state.output` into the `output` field; TTY shows the output, progress ignores it.

## Output examples

### busy (running)

```bash
$ cz-cli agent session status ses_xxx
{"session_id":"ses_xxx","status":"busy","progress":"$ cz-cli table list -o table"}

$ cz-cli agent session status ses_xxx   # a few seconds later
{"session_id":"ses_xxx","status":"busy","progress":"💭 Thinking..."}

$ cz-cli agent session status ses_xxx   # a few more seconds later
{"session_id":"ses_xxx","status":"busy","progress":"✱ Grep \"error\" · 3 matches"}
```

### retry (retrying)

```bash
$ cz-cli agent session status ses_xxx
{"session_id":"ses_xxx","status":"retry","progress":"↻ Retry (attempt 2)","retry":{"attempt":2,"message":"rate_limit","next":1748160300000}}
```

### idle (completed)

```bash
$ cz-cli agent session status ses_xxx
{"session_id":"ses_xxx","status":"idle","result":"Here are the results:\n\n**CZ_ Environment Variables:**\n..."}
```

### Session not found

```bash
$ cz-cli agent session status ses_invalid
{"session_id":"ses_invalid","error":"Session not found"}
```

## Compatibility

### TTY behavior is preserved

`describePart` only extracts the existing "compute icon/title/description/output" logic from the current functions. The TTY path still calls `inline()` / `block()` exactly as before. Visual output is identical to pre-refactor — this is the key validation point in tests.

### Existing SDK / API are untouched

- `agent run` synchronous path, async path, a2a output: **unchanged**
- SDK `event.subscribe()` / `session.prompt()` / `session.promptAsync()`: **unchanged**
- Database schema: **unchanged**
- `agent export` output: **unchanged**

Only `agent session status` JSON output changes from `{session_id, status, updated_at}` to `{session_id, status, progress?, result?, retry?}`. This is an additive change — existing callers reading the `status` field still work, with new optional fields available.

The `updated_at` field is meaningless in the new design (it just reflected the query time), so it's removed — this is the **only breaking change**, but no external caller depends on it yet (this command was added in the previous round and is unreleased).

### Performance

- `session status` adds 1-2 lightweight SQL queries (latest part, last text part), both hitting the primary key + session_id index. SQLite WAL mode does not block writes.
- `describePart` is pure string concatenation, sub-millisecond
- Total status query should complete in <50ms

## Error handling

| Scenario | Output | exit code |
|----------|--------|-----------|
| Session not found | `{"session_id":"...","error":"Session not found"}` | 1 |
| Session exists but no parts (just created) | `{"session_id":"...","status":"idle","result":null}` | 0 |
| `describePart` encounters unknown type | `{icon: "·", title: type}` fallback, no exception | 0 |
| Database read failure | Throws, falls into existing error handler | 1 |

## Test strategy

### Unit tests

New file `packages/opencode/test/session/render.test.ts`:

- One test case per part type, asserting `describePart` returns icon/title/description/output matching the rendering map
- `progressLine` concatenation: with description uses ` · `, without description outputs only `${icon} ${title}`
- Edge cases: missing tool input fields don't crash (e.g. `bash` with no command)
- Unknown part type hits the fallback branch

### TTY non-regression

In `packages/opencode/test/cli/run-display.test.ts` (modify if exists, create if not):
- Simulate a part stream, assert TTY output contains expected icon + title text
- Pre-refactor and post-refactor output is byte-for-byte identical (unless ANSI styling is intentionally changed; this design does not touch ANSI)

### E2E surface

`packages/cz-cli/test/e2e-command-surface.ts` adds:
- `cz-cli agent session status <fake-id>` falls into NO_ACTIVE_LLM path (existing)
- `cz-cli agent session status <real-id>` (without LLM configured) returns idle or not-found correctly

## Implementation order (preserves existing functionality)

Commit in this order; each step ships independently without breakage:

1. **New `render.ts`** — Add `describePart` and `progressLine` with full unit tests. `run.ts` still uses old logic, no behavior change.
2. **Add `latestPart` / `lastTextPart` to Session Service** — Pure data accessors; no caller yet. Unit-tested via fixtures.
3. **Convert `run.ts` to thin shells** — All 12 tool functions plus reasoning/text/step renderers call `describePart`. Run TTY regression tests; confirm output unchanged.
4. **Enhance `session status`** — In the handler, query latest part and last text part, call `progressLine` to build the `progress` field.
5. **Update cz-cli skill docs** — In `skills/cz-cli/SKILL.md`'s "Async mode" section, document the `progress` field.

Each step is its own commit; each step builds and runs tests. If step 3 introduces a TTY visual regression, revert step 3 alone while keeping steps 1-2 (pure functions / data accessors have no side effects).

## Out of scope

- `session status` exposing token / cost totals (could later add `stats: {cost, tokens}` to idle output)
- `session parts` command (cursor-based incremental fetch, considered in the previous design version, dropped)
- Structured phase info in `progress` (e.g. `{kind: "tool", label: "..."}`, unnecessary complexity)
- i18n (progress strings are English, following OpenCode TTY status quo)
