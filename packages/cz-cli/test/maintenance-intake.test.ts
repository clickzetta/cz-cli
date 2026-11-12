import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  acknowledgeIntake,
  executeIntake,
  pendingIntake,
  scanIntake,
  showIntake,
} from "../../../scripts/maintenance/intake"
import type { IntakeRunner } from "../../../scripts/maintenance/intake"
import type { Config, Task } from "../../../scripts/maintenance/state"
import { readRuntime, registerTask, saveTask } from "../../../scripts/maintenance/state"
import { reply } from "../../../scripts/maintenance/reply"

const directories: string[] = []
const now = new Date("2026-11-10T08:00:00Z")
const later = new Date("2026-11-10T08:05:00Z")

afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))

function fixture(tasks: Task[] = []) {
  const directory = mkdtempSync(path.join(tmpdir(), "maintenance-intake-"))
  directories.push(directory)
  const config: Config = {
    repository: "owner/repo",
    baseRef: "origin/main",
    lark: { chatId: "oc_test", identity: "user", sendIdentity: "bot" },
    permissions: {
      push: false,
      createPullRequest: false,
      postGithub: false,
      postLark: false,
      merge: false,
      release: false,
    },
  }
  return { directory, config, tasks }
}

function message(id: string, content: string, updatedAt = "2026-11-10T07:00:00Z", thread = "omt_old") {
  return {
    message_id: id,
    chat_id: "oc_test",
    thread_id: thread,
    create_time: updatedAt,
    update_time: updatedAt,
    content,
    deleted: false,
    message_app_link: `https://example.invalid/${id}`,
  }
}

function oldTask(): Task {
  return {
    id: "task-existing",
    item: {
      source: "lark",
      id: "lark:oc_test:om_old",
      title: "old root",
      body: JSON.stringify({ message: message("om_old", "old root") }),
      url: "",
      updatedAt: "2026-10-01T00:00:00Z",
    },
    status: "needs_attention",
    phase: "implement",
    attempts: 0,
    updatedAt: "2026-10-01T00:00:00Z",
    reviewedSha: null,
  }
}

function lark(
  pages: (argv: string[]) => { messages: unknown[]; has_more?: boolean; page_token?: string },
): IntakeRunner {
  return async (argv) => {
    if (argv.includes("api"))
      return {
        stdout: JSON.stringify({
          ok: true,
          identity: "user",
          data: { items: [message(argv[3].split("/").at(-1)!, "resolved legacy root")] },
        }),
        stderr: "",
        exitCode: 0,
      }
    if (
      argv.includes("+threads-messages-list") &&
      (!argv[argv.indexOf("--thread") + 1].startsWith("omt_") || argv[argv.indexOf("--page-size") + 1] !== "50")
    )
      return { stdout: "", stderr: "field validation failed", exitCode: 1 }
    return {
      stdout: JSON.stringify({ ok: true, identity: "user", data: { has_more: false, ...pages(argv) } }),
      stderr: "",
      exitCode: 0,
    }
  }
}

async function acknowledgeAll(runtime: ReturnType<typeof fixture>, source: "feishu" | "github") {
  for (const entry of (await pendingIntake(runtime.directory, source)).pending)
    await acknowledgeIntake(runtime, source, entry.key, { note: "Read and reconciled existing source" })
}

describe("maintenance intake", () => {
  test("reads a new reply in an old known thread even when roots are empty, and requires explicit acknowledgement", async () => {
    const runtime = fixture([oldTask()])
    const calls: string[][] = []
    const run = lark((argv) => {
      calls.push(argv)
      return {
        messages: argv.includes("+chat-messages-list")
          ? []
          : [
              message("om_old", "old root", "2026-10-01T00:00:00Z"),
              message("om_reply", "tenant setting is now specified"),
            ],
      }
    })
    const first = await scanIntake(runtime, "feishu", run, now)
    expect(calls.some((argv) => argv.includes("+threads-messages-list") && argv.includes("omt_old"))).toBe(true)
    expect(first.pending.map((entry) => entry.id)).toEqual(["om_reply", "om_old"])
    expect(first.pending.every((entry) => entry.taskId === "task-existing")).toBe(true)
    expect(first.fetchedThrough).toBe(now.toISOString())
    expect(first.processedThrough).toBeNull()
    expect((await showIntake(runtime.directory, "feishu", first.pending[1].key)).item.id).toBe("lark:oc_test:om_old")
    expect(statSync(first.pending[1].file).mode & 0o777).toBe(0o600)

    // A new process can read pending inputs without network access or re-discovery.
    expect((await pendingIntake(runtime.directory, "feishu")).pendingCount).toBe(2)
    expect((await scanIntake(runtime, "feishu", run, later)).pendingCount).toBe(2)
    expect(calls.findLast((argv) => argv.includes("+chat-messages-list"))?.includes("2026-11-10T07:55:00.000Z")).toBe(
      true,
    )
    await acknowledgeAll(runtime, "feishu")
    const done = await pendingIntake(runtime.directory, "feishu")
    expect(done.pendingCount).toBe(0)
    expect(done.processedThrough).toBe(later.toISOString())
    expect((await scanIntake(runtime, "feishu", run, later)).pendingCount).toBe(0)
  })

  test("paginates roots and thread replies, including a thread discovered by the second root page", async () => {
    const runtime = fixture()
    const root1 = message("om_1", "root one", undefined, "omt_one")
    const root2 = message("om_2", "root two", undefined, "omt_two")
    const calls: string[][] = []
    const result = await scanIntake(
      runtime,
      "feishu",
      lark((argv) => {
        calls.push(argv)
        if (argv.includes("+chat-messages-list"))
          return argv.includes("--page-token")
            ? { messages: [root2] }
            : { messages: [root1], has_more: true, page_token: "roots-next" }
        if (argv.includes("omt_one"))
          return argv.includes("--page-token")
            ? { messages: [message("om_late", "reply on next page", undefined, "omt_one")] }
            : { messages: [root1], has_more: true, page_token: "thread-next" }
        return { messages: [root2] }
      }),
      now,
    )
    expect(result.pending.map((entry) => entry.id).sort()).toEqual(["om_1", "om_2", "om_late"])
    expect(calls.filter((argv) => argv.includes("--page-token"))).toHaveLength(2)
  })

  test("resolves legacy root and reply aliases into one canonical thread and uses the live API's accepted page size", async () => {
    const runtime = fixture([
      oldTask(),
      { ...oldTask(), id: "task-reply-alias", item: { ...oldTask().item, id: "lark:oc_test:om_legacy_reply" } },
    ])
    const calls: string[][] = []
    const run: IntakeRunner = async (argv) => {
      calls.push(argv)
      if (argv.includes("api")) {
        const id = argv[3].split("/").at(-1)!
        return {
          stdout: JSON.stringify({
            ok: true,
            identity: "user",
            data: {
              items: [
                { ...message(id, "legacy", undefined, "omt_shared"), root_id: id === "om_old" ? undefined : "om_old" },
              ],
            },
          }),
          stderr: "",
          exitCode: 0,
        }
      }
      if (argv.includes("+chat-messages-list"))
        return {
          stdout: JSON.stringify({ ok: true, identity: "user", data: { messages: [], has_more: false } }),
          stderr: "",
          exitCode: 0,
        }
      if (argv[argv.indexOf("--thread") + 1] !== "omt_shared" || argv[argv.indexOf("--page-size") + 1] !== "50")
        return { stdout: "", stderr: "API 99992402 field validation failed", exitCode: 1 }
      return {
        stdout: JSON.stringify({
          ok: true,
          identity: "user",
          data: {
            messages: [
              message("om_old", "root", undefined, "omt_shared"),
              message("om_legacy_reply", "reply", undefined, "omt_shared"),
            ],
            has_more: false,
          },
        }),
        stderr: "",
        exitCode: 0,
      }
    }
    const result = await scanIntake(runtime, "feishu", run, now)
    expect(calls.filter((argv) => argv.includes("api"))).toHaveLength(2)
    expect(calls.filter((argv) => argv.includes("+threads-messages-list"))).toHaveLength(1)
    expect(result.pendingCount).toBe(2)
    expect(result.pending.every((entry) => entry.sourceId === "lark:oc_test:om_old")).toBe(true)
  })

  test("always enqueues a new topic root when the thread API returns no replies, including after the root leaves the overlap window", async () => {
    const runtime = fixture()
    const root = message("om_new_topic", "new arrow zstd question", undefined, "omt_empty")
    const run: IntakeRunner = async (argv) => ({
      stdout: JSON.stringify({
        ok: true,
        identity: "user",
        data: argv.includes("api")
          ? { items: [root] }
          : {
              messages: argv.includes("+chat-messages-list") && !argv.includes("--start") ? [root] : [],
              has_more: false,
            },
      }),
      stderr: "",
      exitCode: 0,
    })
    const first = await scanIntake(runtime, "feishu", run, now)
    expect(first.pending.map((entry) => entry.id)).toEqual(["om_new_topic"])
    expect(first.pending[0].body).toContain("arrow zstd")
    expect((await scanIntake(runtime, "feishu", run, later)).pending.map((entry) => entry.id)).toEqual(["om_new_topic"])
  })

  test("new Feishu intake items pass the actual reply preview's bound-chat validation", async () => {
    const runtime = fixture()
    const root = message("om_new", "new question", undefined, "omt_new")
    const result = await scanIntake(
      runtime,
      "feishu",
      lark((argv) => ({ messages: argv.includes("+chat-messages-list") ? [root] : [] })),
      now,
    )
    const entry = await showIntake(runtime.directory, "feishu", result.pending[0].key)
    expect(JSON.parse(entry.item.body).chat_id).toBe("oc_test")
    const preview = await reply({
      directory: runtime.directory,
      config: runtime.config,
      task: { id: "task-new", item: entry.item },
      phase: "接单",
      event: "new-topic",
      text: "已收到，开始检查。",
    })
    expect(preview.status).toBe("preview")
    expect(preview.targetMessageId).toBe("om_new")
  })

  test("a reply-keyed legacy task owns both its canonical root and replies across register, save, ack and reply preview", async () => {
    const root = message("om_root", "actual root")
    const response = { ...message("om_legacy_reply", "legacy reply"), root_id: "om_root" }
    const legacy = {
      ...oldTask(),
      item: {
        ...oldTask().item,
        id: "lark:oc_test:om_legacy_reply",
        body: JSON.stringify({ chat_id: "oc_test", message: response }),
      },
    }
    const runtime = fixture([legacy])
    await Bun.write(path.join(runtime.directory, "config.json"), JSON.stringify(runtime.config))
    await Bun.write(path.join(runtime.directory, "state.json"), JSON.stringify({ tasks: runtime.tasks }))
    const run: IntakeRunner = async (argv) => ({
      stdout: JSON.stringify({
        ok: true,
        identity: "user",
        data: argv.includes("api")
          ? { items: [argv[3].endsWith("om_root") ? root : response] }
          : { messages: argv.includes("+chat-messages-list") ? [] : [response], has_more: false },
      }),
      stderr: "",
      exitCode: 0,
    })
    const result = await scanIntake(runtime, "feishu", run, now)
    expect(result.pending.map((entry) => entry.id).sort()).toEqual(["om_legacy_reply", "om_root"])
    expect(result.pending.every((entry) => entry.taskId === legacy.id && entry.sourceId === legacy.item.id)).toBe(true)
    for (const summary of result.pending) {
      const entry = await showIntake(runtime.directory, "feishu", summary.key)
      expect((await registerTask(runtime.directory, entry.item)).id).toBe(legacy.id)
      const updated = await saveTask(runtime.directory, { ...legacy, item: entry.item })
      expect(JSON.parse(updated.item.body).rootMessage.message_id).toBe("om_root")
      expect(JSON.parse(updated.item.body).message.message_id).toBe("om_legacy_reply")
      const preview = await reply({
        directory: runtime.directory,
        config: runtime.config,
        task: updated,
        phase: "接单",
        event: "legacy-thread",
        text: "已收到补充。",
      })
      expect(preview.status).toBe("preview")
      expect(preview.targetMessageId).toBe("om_legacy_reply")
      await acknowledgeIntake(runtime, "feishu", entry.key, { taskId: legacy.id })
    }
    expect((await readRuntime(runtime.directory)).tasks).toHaveLength(1)
    expect((await pendingIntake(runtime.directory, "feishu")).pendingCount).toBe(0)
  })

  test("does not mistake the first reply for its root and repairs a stored reply alias by following root_id", async () => {
    const runtime = fixture([oldTask()])
    const root = message("om_old", "actual root")
    const reply = { ...message("om_first_reply", "first reply"), root_id: "om_old" }
    const run: IntakeRunner = async (argv) => ({
      stdout: JSON.stringify({
        ok: true,
        identity: "user",
        data: argv.includes("api")
          ? { items: [argv[3].endsWith("om_first_reply") ? reply : root] }
          : { messages: argv.includes("+chat-messages-list") ? [] : [reply], has_more: false },
      }),
      stderr: "",
      exitCode: 0,
    })
    const first = await scanIntake(runtime, "feishu", run, now)
    expect(first.pending.map((entry) => entry.id).sort()).toEqual(["om_first_reply", "om_old"])
    expect(first.pending.every((entry) => entry.sourceId === "lark:oc_test:om_old")).toBe(true)
    const file = path.join(runtime.directory, "intake/feishu.json")
    const state = JSON.parse(readFileSync(file, "utf8"))
    state.threads.omt_old.rootId = "om_first_reply"
    writeFileSync(file, JSON.stringify(state))
    expect((await scanIntake(runtime, "feishu", run, later)).pendingCount).toBe(2)
    expect(JSON.parse(readFileSync(file, "utf8")).threads.omt_old.rootId).toBe("om_old")
  })

  test("retains ordinary non-topic messages without trying an invalid thread request", async () => {
    const runtime = fixture()
    const calls: string[][] = []
    const plain = {
      message_id: "om_plain",
      chat_id: "oc_test",
      thread_id: "",
      body: { content: '{"text":"ordinary message"}' },
      create_time: "2026-11-10T07:00:00Z",
      update_time: "2026-11-10T07:00:00Z",
    }
    const result = await scanIntake(
      runtime,
      "feishu",
      async (argv) => {
        calls.push(argv)
        return {
          stdout: JSON.stringify({ ok: true, identity: "user", data: { messages: [plain], has_more: false } }),
          stderr: "",
          exitCode: 0,
        }
      },
      now,
    )
    expect(calls).toHaveLength(1)
    expect(result.pending[0].sourceId).toBe("lark:oc_test:om_plain")
    expect(result.pending[0].body).toBe('{"text":"ordinary message"}')
  })

  test("failed or looping pagination never commits a success cursor or partial pending items", async () => {
    const runtime = fixture([oldTask()])
    const run = lark((argv) => ({ messages: argv.includes("+chat-messages-list") ? [] : [message("om_old", "old")] }))
    await scanIntake(runtime, "feishu", run, now)
    const file = path.join(runtime.directory, "intake/feishu.json")
    const before = readFileSync(file, "utf8")
    await expect(
      scanIntake(
        runtime,
        "feishu",
        lark((argv) => {
          if (argv.includes("+chat-messages-list")) return { messages: [] }
          return { messages: [message("om_new", "must not commit")], has_more: true, page_token: "same-token" }
        }),
        later,
      ),
    ).rejects.toThrow("repeated Feishu page token")
    expect(readFileSync(file, "utf8")).toBe(before)
    expect(statSync(path.join(runtime.directory, "intake/feishu.lock")).mode & 0o777).toBe(0o600)
    await expect(
      scanIntake(runtime, "feishu", async () => ({ stdout: "{}", stderr: "private failure", exitCode: 1 }), later),
    ).rejects.toThrow("cursor unchanged")
    expect(readFileSync(file, "utf8")).toBe(before)
  })

  test("consumes a persisted event for an unknown old thread and remembers its receipt only after complete fetch", async () => {
    const runtime = fixture()
    mkdirSync(path.join(runtime.directory, "events/received"), { recursive: true })
    writeFileSync(
      path.join(runtime.directory, "events/received/event.json"),
      JSON.stringify({ eventId: "ev_1", chatId: "oc_test", messageId: "om_event" }),
    )
    const calls: string[][] = []
    const run: IntakeRunner = async (argv) => {
      calls.push(argv)
      if (argv.includes("api"))
        return {
          stdout: JSON.stringify({
            ok: true,
            identity: "user",
            data: {
              items: [
                {
                  ...message(argv[3].split("/").at(-1)!, "event reply", undefined, "omt_event"),
                  root_id: argv[3].endsWith("om_event") ? "om_ancient" : undefined,
                },
              ],
            },
          }),
          stderr: "",
          exitCode: 0,
        }
      return lark((args) => ({
        messages: args.includes("+chat-messages-list")
          ? []
          : [
              message("om_ancient", "old root", "2026-09-01T00:00:00Z", "omt_event"),
              message("om_event", "event reply", undefined, "omt_event"),
            ],
      }))(argv)
    }
    await expect(
      scanIntake(
        runtime,
        "feishu",
        async (argv) =>
          argv.includes("+threads-messages-list")
            ? { stdout: "", stderr: "temporary thread failure", exitCode: 1 }
            : run(argv),
        now,
      ),
    ).rejects.toThrow("cursor unchanged")
    expect(existsSync(path.join(runtime.directory, "intake/feishu.json"))).toBe(false)
    const first = await scanIntake(runtime, "feishu", run, now)
    expect(first.pending.map((entry) => entry.id)).toEqual(["om_event", "om_ancient"])
    expect(first.pending.every((entry) => entry.sourceId === "lark:oc_test:om_ancient")).toBe(true)
    await scanIntake(runtime, "feishu", run, later)
    expect(calls.filter((argv) => argv.includes("api") && argv[3].endsWith("om_event"))).toHaveLength(2)
    expect(calls.filter((argv) => argv.includes("omt_event"))).toHaveLength(2)
  })

  test("ack is idempotent, requires a decision, and cannot silently change its task association", async () => {
    const runtime = fixture([oldTask()])
    const result = await scanIntake(
      runtime,
      "feishu",
      lark((argv) => ({ messages: argv.includes("+chat-messages-list") ? [] : [message("om_old", "old")] })),
      now,
    )
    const key = result.pending[0].key
    await expect(acknowledgeIntake(runtime, "feishu", key, {})).rejects.toThrow("requires --task or --note")
    await expect(acknowledgeIntake(runtime, "feishu", key, { taskId: "unknown" })).rejects.toThrow(
      "Unknown acknowledgement task",
    )
    const other = { ...oldTask(), id: "task-other", item: { ...oldTask().item, id: "lark:oc_test:om_other" } }
    await expect(
      acknowledgeIntake({ ...runtime, tasks: [other] }, "feishu", key, { taskId: "task-other" }),
    ).rejects.toThrow("different source")
    expect((await acknowledgeIntake(runtime, "feishu", key, { taskId: "task-existing" })).status).toBe("acknowledged")
    expect((await acknowledgeIntake(runtime, "feishu", key, { taskId: "task-existing" })).status).toBe("acknowledged")
    await expect(acknowledgeIntake(runtime, "feishu", key, { note: "different decision" })).rejects.toThrow(
      "different decision",
    )
  })

  test("does not turn its own confirmed Bot replies into new input, while retaining human replies and full context", async () => {
    const runtime = fixture([oldTask()])
    mkdirSync(path.join(runtime.directory, "outbox/replies"), { recursive: true })
    writeFileSync(
      path.join(runtime.directory, "outbox/replies/sent.json"),
      JSON.stringify({
        taskId: "task-existing",
        phase: "阻碍",
        event: "waiting",
        sequence: 1,
        key: "task-existing-阻碍-1",
        chatId: "oc_test",
        targetMessageId: "om_old",
        text: "same text",
        identity: "bot",
        status: "sent",
        attemptedAt: now.toISOString(),
        messageId: "om_ours",
        sentAt: now.toISOString(),
      }),
    )
    const result = await scanIntake(
      runtime,
      "feishu",
      lark((argv) => ({
        messages: argv.includes("+chat-messages-list")
          ? []
          : [message("om_old", "root"), message("om_ours", "same text"), message("om_human", "same text")],
      })),
      now,
    )
    expect(result.pending.map((entry) => entry.id).sort()).toEqual(["om_human", "om_old"])
    const event = await showIntake(runtime.directory, "feishu", result.pending[1].key)
    expect(JSON.parse(event.item.body).threadMessages).toHaveLength(3)
  })

  test("detects an Issue, comment, review comment and review change without a PR head update or numeric cutoff", async () => {
    const runtime = fixture()
    const calls: string[][] = []
    const data = {
      issues: [
        {
          id: 100,
          number: 3,
          title: "new issue",
          body: "reproduction",
          state: "open",
          updated_at: "2026-11-10T07:00:00Z",
        },
      ],
      comments: [
        {
          id: 200,
          issue_url: "https://api.github.com/repos/owner/repo/issues/45",
          body: "initial comment",
          updated_at: "2026-11-10T07:00:00Z",
        },
      ],
      reviews: [
        { id: 300, state: "APPROVED", body: "review", submitted_at: "2026-11-10T07:00:00Z", commit_id: "same-head" },
      ],
    }
    const run = github(data, calls)
    const first = await scanIntake(runtime, "github", run, now)
    expect(first.pending.map((entry) => entry.kind).sort()).toEqual([
      "github-issue",
      "github-issue-comment",
      "github-pr",
      "github-review",
      "github-review-comment",
    ])
    await acknowledgeAll(runtime, "github")
    const oldComment = first.pending.find((entry) => entry.kind === "github-issue-comment")!
    data.comments[0].body = "edited existing comment"
    data.comments.push({
      id: 201,
      issue_url: "https://api.github.com/repos/owner/repo/issues/45",
      body: "new question without a commit",
      updated_at: "2026-11-10T08:02:00Z",
    })
    data.issues.push({
      id: 101,
      number: 2,
      title: "another issue",
      body: "new low number",
      state: "open",
      updated_at: "2026-11-10T08:02:00Z",
    })
    data.reviews[0].state = "DISMISSED"
    const second = await scanIntake(runtime, "github", run, later)
    expect(second.pending.map((entry) => entry.kind).sort()).toEqual([
      "github-issue",
      "github-issue-comment",
      "github-issue-comment",
      "github-review",
    ])
    expect(second.pending.some((entry) => entry.body.includes("without a commit"))).toBe(true)
    expect(second.pending.find((entry) => entry.id === "200")?.key).not.toBe(oldComment.key)
    expect((await showIntake(runtime.directory, "github", oldComment.key)).body).toBe("initial comment")
    expect(existsSync(path.join(runtime.directory, "intake/ack/github", `${oldComment.key}.json`))).toBe(true)
    await acknowledgeAll(runtime, "github")
    expect((await scanIntake(runtime, "github", run, later)).pendingCount).toBe(0)
    expect(calls.some((argv) => argv.at(-1)?.includes("issues/comments?"))).toBe(true)
    expect(calls.some((argv) => argv.at(-1)?.includes("pulls/comments?"))).toBe(true)
    expect(calls.some((argv) => argv.at(-1)?.includes("pulls/45/reviews?"))).toBe(true)
  })

  test("comments and reviews from bots, such as AI review, never become pending feedback", async () => {
    const runtime = fixture()
    const bot = { login: "github-actions[bot]", type: "Bot" }
    const data = {
      issues: [],
      comments: [
        { id: 500, issue_url: "https://api.github.com/repos/owner/repo/issues/45", body: "AI review summary", updated_at: "2026-11-10T07:00:00Z", user: bot },
        { id: 501, issue_url: "https://api.github.com/repos/owner/repo/issues/45", body: "a human question", updated_at: "2026-11-10T07:00:00Z", user: { login: "alice", type: "User" } },
      ],
      reviews: [{ id: 600, state: "COMMENTED", body: "bot review", submitted_at: "2026-11-10T07:00:00Z", commit_id: "same-head", user: bot }],
    }
    const result = await scanIntake(runtime, "github", github(data, []), now)
    const bodies = result.pending.map((entry) => entry.body)
    expect(bodies).toContain("a human question")
    expect(bodies).not.toContain("AI review summary")
    expect(bodies).not.toContain("bot review")
  })

  test("paginates every GitHub endpoint and keeps its cursor when a later page fails", async () => {
    const runtime = fixture()
    const calls: string[] = []
    const run: IntakeRunner = async (argv) => {
      const url = new URL(`https://api.github.com/${argv.at(-1)}`)
      calls.push(url.pathname + url.search)
      const full = url.pathname.endsWith("/issues/comments") && url.searchParams.get("page") === "1"
      return {
        stdout: JSON.stringify(
          full
            ? Array.from({ length: 100 }, (_, id) => ({
                id,
                issue_url: "https://api.github.com/repos/owner/repo/issues/3",
                body: "comment",
                updated_at: "2026-11-10T07:00:00Z",
              }))
            : url.pathname.endsWith("/issues/comments")
              ? [
                  {
                    id: 500,
                    issue_url: "https://api.github.com/repos/owner/repo/issues/3",
                    body: "newest question must not be buried",
                    updated_at: "2026-11-10T07:59:00Z",
                  },
                ]
              : [],
        ),
        stderr: "",
        exitCode: 0,
      }
    }
    const first = await scanIntake(runtime, "github", run, now)
    expect(first.pendingCount).toBe(101)
    expect(first.pending).toHaveLength(50)
    expect(first.pending[0].id).toBe("500")
    expect(first.pending.slice(1).map((entry) => entry.key)).toEqual(
      first.pending
        .slice(1)
        .map((entry) => entry.key)
        .sort(),
    )
    expect(first.hasMore).toBe(true)
    expect(calls.some((url) => url.includes("issues/comments?") && url.includes("page=2"))).toBe(true)
    const file = path.join(runtime.directory, "intake/github.json")
    const before = readFileSync(file, "utf8")
    await expect(
      scanIntake(
        runtime,
        "github",
        async (argv) => (argv.at(-1)?.includes("page=2") ? { stdout: "", stderr: "failure", exitCode: 1 } : run(argv)),
        later,
      ),
    ).rejects.toThrow("cursor unchanged")
    expect(readFileSync(file, "utf8")).toBe(before)
  })

  test("request timeout kills its real child and preserves the previously committed cursor", async () => {
    const runtime = fixture()
    await scanIntake(
      runtime,
      "feishu",
      lark(() => ({ messages: [] })),
      now,
    )
    const file = path.join(runtime.directory, "intake/feishu.json")
    const before = readFileSync(file, "utf8")
    const result = { timedOut: false, exitCode: 0 }
    await expect(
      scanIntake(
        runtime,
        "feishu",
        async () => {
          const executed = await executeIntake(
            [process.execPath, "-e", "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"],
            50,
          )
          Object.assign(result, executed)
          return executed
        },
        later,
      ),
    ).rejects.toThrow("cursor unchanged")
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).not.toBe(0)
    expect(readFileSync(file, "utf8")).toBe(before)
  })

  test("kernel ownership rejects a concurrent reader and recovers after the owner receives SIGKILL", async () => {
    const runtime = fixture()
    const ready = path.join(runtime.directory, "ready")
    const script = path.join(runtime.directory, "hold.ts")
    writeFileSync(
      script,
      `import { scanIntake } from ${JSON.stringify(path.resolve(import.meta.dir, "../../../scripts/maintenance/intake.ts"))};
await scanIntake(JSON.parse(process.env.CZ_TEST_INTAKE_RUNTIME!), "feishu", async () => {
  await Bun.write(process.env.CZ_TEST_INTAKE_READY!, "ready");
  return new Promise<never>(() => {});
});`,
    )
    const child = Bun.spawn([process.execPath, script], {
      env: { ...process.env, CZ_TEST_INTAKE_RUNTIME: JSON.stringify(runtime), CZ_TEST_INTAKE_READY: ready },
      stdout: "pipe",
      stderr: "pipe",
    })
    try {
      for (let attempt = 0; attempt < 200 && !existsSync(ready); attempt++) await Bun.sleep(10)
      expect(existsSync(ready)).toBe(true)
      const lock = path.join(runtime.directory, "intake/feishu.lock")
      const previous = JSON.parse(readFileSync(lock, "utf8"))
      await expect(
        scanIntake(
          runtime,
          "feishu",
          lark(() => ({ messages: [] })),
          now,
        ),
      ).rejects.toThrow("already has an owner")
      child.kill("SIGKILL")
      await child.exited
      const recovery = { acquired: false }
      for (let attempt = 0; attempt < 100 && !recovery.acquired; attempt++) {
        recovery.acquired = await scanIntake(
          runtime,
          "feishu",
          lark(() => ({ messages: [] })),
          now,
        ).then(
          () => true,
          (error: unknown) => {
            if (error instanceof Error && error.message.includes("already has an owner")) return false
            throw error
          },
        )
        if (!recovery.acquired) await Bun.sleep(10)
      }
      expect(recovery.acquired).toBe(true)
      expect(JSON.parse(readFileSync(lock, "utf8")).nonce).not.toBe(previous.nonce)
      expect((await pendingIntake(runtime.directory, "feishu")).processedThrough).toBe(now.toISOString())
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL")
      await child.exited
    }
  })

  test("pending, show and ack survive separate CLI processes without fetching or losing an input", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "maintenance-intake-cli-"))
    directories.push(root)
    const init = Bun.spawn(["git", "init", "-q", root], { stdout: "pipe", stderr: "pipe" })
    expect(await init.exited).toBe(0)
    const runtime = { ...fixture([oldTask()]), directory: path.join(root, ".git/cz-maintenance") }
    mkdirSync(runtime.directory, { recursive: true })
    await Bun.write(path.join(runtime.directory, "config.json"), JSON.stringify(runtime.config))
    await Bun.write(path.join(runtime.directory, "state.json"), JSON.stringify({ tasks: runtime.tasks }))
    const first = await scanIntake(
      runtime,
      "feishu",
      lark((argv) => ({ messages: argv.includes("+chat-messages-list") ? [] : [message("om_old", "old")] })),
      now,
    )
    const script = path.resolve(import.meta.dir, "../../../scripts/maintenance.ts")
    const cli = async (args: string[]) => {
      const child = Bun.spawn([process.execPath, script, "intake", ...args], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      })
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(stderr).toBe("")
      expect(code).toBe(0)
      return JSON.parse(stdout)
    }
    expect((await cli(["pending", "feishu"])).pendingCount).toBe(1)
    expect((await cli(["show", "feishu", first.pending[0].key])).item.id).toBe("lark:oc_test:om_old")
    expect((await cli(["ack", "feishu", first.pending[0].key, "--task", "task-existing"])).status).toBe("acknowledged")
    expect((await cli(["pending", "feishu"])).pendingCount).toBe(0)
  })
})

function github(
  data: { issues: Record<string, unknown>[]; comments: Record<string, unknown>[]; reviews: Record<string, unknown>[] },
  calls: string[][],
): IntakeRunner {
  return async (argv) => {
    calls.push(argv)
    const url = new URL(`https://api.github.com/${argv.at(-1)}`)
    const result = url.pathname.endsWith("/issues")
      ? data.issues
      : url.pathname.endsWith("/issues/comments")
        ? data.comments
        : url.pathname.endsWith("/pulls/comments")
          ? [
              {
                id: 400,
                pull_request_url: "https://api.github.com/repos/owner/repo/pulls/45",
                body: "inline question",
                updated_at: "2026-11-10T07:00:00Z",
              },
            ]
          : url.pathname.endsWith("/reviews")
            ? data.reviews
            : [
                {
                  id: 45,
                  number: 45,
                  title: "old PR",
                  body: "same source",
                  state: "open",
                  updated_at: "2026-10-01T00:00:00Z",
                  head: { sha: "same-head" },
                },
              ]
    return { stdout: JSON.stringify(result), stderr: "", exitCode: 0 }
  }
}
