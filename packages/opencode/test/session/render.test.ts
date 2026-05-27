import { describe, expect, test } from "bun:test"
import { describePart, progressLine } from "../../src/session/render"
import { SessionID, MessageID, PartID } from "../../src/session/schema"
import type { MessageV2 } from "../../src/session/message-v2"

const sid = SessionID.make("ses_test")
const mid = MessageID.make("msg_test")
const pid = PartID.make("prt_test")

function part<T extends MessageV2.Part>(p: Omit<T, "id" | "sessionID" | "messageID">): T {
  return { id: pid, sessionID: sid, messageID: mid, ...p } as T
}

describe("describePart", () => {
  test("bash tool with command", () => {
    const d = describePart(
      part<MessageV2.ToolPart>({
        type: "tool",
        callID: "call_1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "ls -la" },
          output: "file1\nfile2",
          title: "ls -la",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      }),
    )
    expect(d.icon).toBe("$")
    expect(d.title).toBe("ls -la")
    expect(d.output).toBe("file1\nfile2")
  })

  test("bash tool while running has no output", () => {
    const d = describePart(
      part<MessageV2.ToolPart>({
        type: "tool",
        callID: "call_1",
        tool: "bash",
        state: { status: "running", input: { command: "sleep 5" }, time: { start: 1 } },
      }),
    )
    expect(d.icon).toBe("$")
    expect(d.title).toBe("sleep 5")
    expect(d.output).toBeUndefined()
  })

  test("read tool with extra params", () => {
    const d = describePart(
      part<MessageV2.ToolPart>({
        type: "tool",
        callID: "call_1",
        tool: "read",
        state: {
          status: "completed",
          input: { filePath: "/abs/path/file.ts", offset: 10, limit: 50 },
          output: "",
          title: "",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      }),
    )
    expect(d.icon).toBe("→")
    expect(d.title).toContain("Read ")
    expect(d.title).toContain("file.ts")
    expect(d.description).toBe("[offset=10, limit=50]")
  })

  test("grep tool with match count", () => {
    const d = describePart(
      part<MessageV2.ToolPart>({
        type: "tool",
        callID: "call_1",
        tool: "grep",
        state: {
          status: "completed",
          input: { pattern: "TODO", path: "src" },
          output: "",
          title: "",
          metadata: { matches: 3 },
          time: { start: 1, end: 2 },
        },
      }),
    )
    expect(d.icon).toBe("✱")
    expect(d.title).toBe(`Grep "TODO"`)
    expect(d.description).toBe("in src · 3 matches")
  })

  test("grep tool with single match", () => {
    const d = describePart(
      part<MessageV2.ToolPart>({
        type: "tool",
        callID: "call_1",
        tool: "grep",
        state: {
          status: "completed",
          input: { pattern: "X" },
          output: "",
          title: "",
          metadata: { matches: 1 },
          time: { start: 1, end: 2 },
        },
      }),
    )
    expect(d.description).toBe("1 match")
  })

  test("task tool icon depends on status", () => {
    const make = (status: "running" | "completed" | "error") =>
      describePart(
        part<MessageV2.ToolPart>({
          type: "tool",
          callID: "call_1",
          tool: "task",
          state:
            status === "running"
              ? { status: "running", input: { subagent_type: "explore", description: "find X" }, time: { start: 1 } }
              : status === "completed"
                ? {
                    status: "completed",
                    input: { subagent_type: "explore", description: "find X" },
                    output: "",
                    title: "",
                    metadata: {},
                    time: { start: 1, end: 2 },
                  }
                : {
                    status: "error",
                    input: { subagent_type: "explore", description: "find X" },
                    error: "boom",
                    time: { start: 1, end: 2 },
                  },
        }),
      )
    expect(make("running").icon).toBe("•")
    expect(make("completed").icon).toBe("✓")
    expect(make("error").icon).toBe("✗")
    expect(make("running").title).toBe("find X")
    expect(make("running").description).toBe("Explore Agent")
  })

  test("task tool fallback to subagent name when description missing", () => {
    const d = describePart(
      part<MessageV2.ToolPart>({
        type: "tool",
        callID: "call_1",
        tool: "task",
        state: { status: "running", input: { subagent_type: "review" }, time: { start: 1 } },
      }),
    )
    expect(d.title).toBe("Review Task")
    expect(d.description).toBeUndefined()
  })

  test("write tool produces block with output", () => {
    const d = describePart(
      part<MessageV2.ToolPart>({
        type: "tool",
        callID: "call_1",
        tool: "write",
        state: {
          status: "completed",
          input: { filePath: "/abs/file.ts" },
          output: "ok",
          title: "",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      }),
    )
    expect(d.icon).toBe("←")
    expect(d.title).toContain("Write ")
    expect(d.output).toBe("ok")
  })

  test("edit tool surfaces diff as output", () => {
    const d = describePart(
      part<MessageV2.ToolPart>({
        type: "tool",
        callID: "call_1",
        tool: "edit",
        state: {
          status: "completed",
          input: { filePath: "/abs/file.ts" },
          output: "",
          title: "",
          metadata: { diff: "- old\n+ new" },
          time: { start: 1, end: 2 },
        },
      }),
    )
    expect(d.icon).toBe("←")
    expect(d.title).toContain("Edit ")
    expect(d.output).toBe("- old\n+ new")
  })

  test("glob with count and path", () => {
    const d = describePart(
      part<MessageV2.ToolPart>({
        type: "tool",
        callID: "call_1",
        tool: "glob",
        state: {
          status: "completed",
          input: { pattern: "*.ts", path: "src" },
          output: "",
          title: "",
          metadata: { count: 7 },
          time: { start: 1, end: 2 },
        },
      }),
    )
    expect(d.icon).toBe("✱")
    expect(d.title).toBe(`Glob "*.ts"`)
    expect(d.description).toBe("in src · 7 matches")
  })

  test("webfetch", () => {
    const d = describePart(
      part<MessageV2.ToolPart>({
        type: "tool",
        callID: "call_1",
        tool: "webfetch",
        state: { status: "running", input: { url: "https://example.com" }, time: { start: 1 } },
      }),
    )
    expect(d.icon).toBe("%")
    expect(d.title).toBe("WebFetch https://example.com")
  })

  test("codesearch and websearch", () => {
    const cs = describePart(
      part<MessageV2.ToolPart>({
        type: "tool",
        callID: "call_1",
        tool: "codesearch",
        state: { status: "running", input: { query: "useEffect" }, time: { start: 1 } },
      }),
    )
    expect(cs.icon).toBe("◇")
    expect(cs.title).toBe(`Exa Code Search "useEffect"`)
    const ws = describePart(
      part<MessageV2.ToolPart>({
        type: "tool",
        callID: "call_1",
        tool: "websearch",
        state: { status: "running", input: { query: "node 24 lts" }, time: { start: 1 } },
      }),
    )
    expect(ws.icon).toBe("◈")
    expect(ws.title).toBe(`Exa Web Search "node 24 lts"`)
  })

  test("skill", () => {
    const d = describePart(
      part<MessageV2.ToolPart>({
        type: "tool",
        callID: "call_1",
        tool: "skill",
        state: { status: "running", input: { name: "writing-plans" }, time: { start: 1 } },
      }),
    )
    expect(d.icon).toBe("→")
    expect(d.title).toBe(`Load skill "writing-plans"`)
  })

  test("todowrite renders todo lines as output", () => {
    const d = describePart(
      part<MessageV2.ToolPart>({
        type: "tool",
        callID: "call_1",
        tool: "todowrite",
        state: {
          status: "completed",
          input: {
            todos: [
              { content: "do A", status: "completed" },
              { content: "do B", status: "pending" },
            ],
          },
          output: "",
          title: "",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      }),
    )
    expect(d.icon).toBe("#")
    expect(d.title).toBe("Todos")
    expect(d.output).toBe("[x] do A\n[ ] do B")
    expect(d.description).toBe("1/2 done · 1 pending")
  })

  test("todowrite description surfaces in-progress task title", () => {
    const d = describePart(
      part<MessageV2.ToolPart>({
        type: "tool",
        callID: "call_1",
        tool: "todowrite",
        state: {
          status: "completed",
          input: {
            todos: [
              { content: "load skill", status: "in_progress" },
              { content: "backfill", status: "pending" },
              { content: "register schedule", status: "pending" },
            ],
          },
          output: "",
          title: "",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      }),
    )
    expect(d.description).toBe("0/3 done · in-progress: load skill")
  })

  test("unknown tool falls back to gear icon", () => {
    const d = describePart(
      part<MessageV2.ToolPart>({
        type: "tool",
        callID: "call_1",
        tool: "mystery",
        state: { status: "running", input: { foo: "bar" }, time: { start: 1 } },
      }),
    )
    expect(d.icon).toBe("⚙")
    expect(d.title).toContain("mystery")
  })

  test("text part", () => {
    const d = describePart(part<MessageV2.TextPart>({ type: "text", text: "hello" }))
    expect(d.icon).toBe("✏")
    expect(d.title).toBe("Generating response...")
  })

  test("reasoning part", () => {
    const d = describePart(
      part<MessageV2.ReasoningPart>({ type: "reasoning", text: "let me think", time: { start: 1 } }),
    )
    expect(d.icon).toBe("💭")
    expect(d.title).toBe("Thinking...")
  })

  test("step-start and step-finish", () => {
    const start = describePart(part<MessageV2.StepStartPart>({ type: "step-start" }))
    expect(start.icon).toBe("▶")
    expect(start.title).toBe("Calling LLM...")
    const finish = describePart(
      part<MessageV2.StepFinishPart>({
        type: "step-finish",
        reason: "tool-calls",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
    )
    expect(finish.icon).toBe("✓")
    expect(finish.title).toBe("Step done (tool-calls)")
  })

  test("retry part", () => {
    expect(
      describePart(
        part<MessageV2.RetryPart>({
          type: "retry",
          attempt: 2,
          error: { name: "APIError", data: { message: "limited", isRetryable: true } },
          time: { created: 1 },
        }),
      ).title,
    ).toBe("Retry (attempt 2)")
  })

  test("compaction part", () => {
    expect(
      describePart(part<MessageV2.CompactionPart>({ type: "compaction", auto: true })).title,
    ).toBe("Compacting context...")
  })

  test("patch part", () => {
    expect(
      describePart(
        part<MessageV2.PatchPart>({ type: "patch", hash: "h", files: ["a", "b"] }),
      ).title,
    ).toBe("Patch (2 files)")
  })

  test("snapshot part", () => {
    expect(
      describePart(part<MessageV2.SnapshotPart>({ type: "snapshot", snapshot: "s" })).title,
    ).toBe("Snapshot")
  })

  test("subtask part", () => {
    expect(
      describePart(
        part<MessageV2.SubtaskPart>({ type: "subtask", prompt: "p", description: "do thing", agent: "explore" }),
      ).title,
    ).toBe("Subtask: do thing")
  })

  test("agent part", () => {
    expect(describePart(part<MessageV2.AgentPart>({ type: "agent", name: "explore" })).title).toBe("Agent explore")
  })

  test("file part", () => {
    expect(
      describePart(
        part<MessageV2.FilePart>({ type: "file", mime: "text/plain", filename: "a.txt", url: "file:///x" }),
      ).title,
    ).toBe("File a.txt")
  })

  test("task tool with pending status uses running dot", () => {
    const d = describePart(
      part<MessageV2.ToolPart>({
        type: "tool",
        callID: "call_1",
        tool: "task",
        state: {
          status: "pending",
          input: { subagent_type: "review", description: "do thing" },
          raw: "",
        },
      }),
    )
    expect(d.icon).toBe("•")
  })

  test("todowrite with malformed items does not produce 'undefined' output", () => {
    const d = describePart(
      part<MessageV2.ToolPart>({
        type: "tool",
        callID: "call_1",
        tool: "todowrite",
        state: {
          status: "completed",
          input: { todos: [{ content: 42, status: null }, "not an object"] as unknown as Array<{ content: string; status: string }> },
          output: "",
          title: "",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      }),
    )
    expect(d.output).not.toContain("undefined")
  })
})

describe("progressLine", () => {
  test("formats icon + title without description", () => {
    const line = progressLine(part<MessageV2.TextPart>({ type: "text", text: "" }))
    expect(line).toBe("✏ Generating response...")
  })

  test("formats icon + title + description with separator", () => {
    const line = progressLine(
      part<MessageV2.ToolPart>({
        type: "tool",
        callID: "call_1",
        tool: "grep",
        state: {
          status: "completed",
          input: { pattern: "X" },
          output: "",
          title: "",
          metadata: { matches: 5 },
          time: { start: 1, end: 2 },
        },
      }),
    )
    expect(line).toBe(`✱ Grep "X" · 5 matches`)
  })

  test("ignores output field", () => {
    const line = progressLine(
      part<MessageV2.ToolPart>({
        type: "tool",
        callID: "call_1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "echo hi" },
          output: "hi",
          title: "echo hi",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      }),
    )
    expect(line).toBe("$ echo hi")
    expect(line).not.toContain("hi\n")
  })
})
