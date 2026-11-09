import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { executeReply, readReceipts, reply } from "../../../scripts/maintenance/reply"
import type { ReplyInput, ReplyRunner } from "../../../scripts/maintenance/reply"

const directories: string[] = []

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
})

function input(): ReplyInput {
  const directory = mkdtempSync(path.join(tmpdir(), "cz-maintenance-reply-"))
  directories.push(directory)
  return {
    directory,
    config: { permissions: { postLark: true }, lark: { chatId: "oc_bound", identity: "user", sendIdentity: "bot" } },
    task: {
      id: "task-aabbcc001122",
      item: {
        source: "lark",
        id: "lark:oc_bound:om_original",
        body: JSON.stringify({ chat_id: "oc_bound", message: { message_id: "om_original" } }),
      },
    },
    phase: "阻碍",
    event: "missing-configuration",
    text: "缺少配置，已保留任务。",
    send: true,
  }
}

function transport(
  directory: string,
  mode: "success" | "timeout" | "not-member" | "wrong-chat" | "missing-id" = "success",
) {
  const calls: string[][] = []
  const run: ReplyRunner = async (argv) => {
    calls.push(argv)
    if (argv[1] === "api" && argv[3].endsWith("/is_in_chat"))
      return {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify({ ok: true, data: { is_in_chat: mode !== "not-member" } }),
      }
    if (argv[1] === "api")
      return {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify({
          code: 0,
          data: {
            items: [{ message_id: "om_original", chat_id: mode === "wrong-chat" ? "oc_elsewhere" : "oc_bound" }],
          },
        }),
      }
    const sending = (await readReceipts(directory)).filter((entry) => entry.status === "sending")
    expect(sending).toHaveLength(1)
    expect(argv).toContain("--reply-in-thread")
    expect(argv[argv.indexOf("--as") + 1]).toBe("bot")
    expect(argv[argv.indexOf("--idempotency-key") + 1]).toBe(sending[0].key)
    if (mode === "timeout") throw new Error("Transport timed out after submission")
    return {
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({
        ok: true,
        identity: "bot",
        data: {
          chat_id: "oc_bound",
          ...(mode === "missing-id"
            ? {}
            : { message_id: `om_sent_${calls.filter((entry) => entry[1] === "im").length}` }),
        },
      }),
    }
  }
  return { calls, run }
}

describe("persistent maintenance Bot replies", () => {
  test("preview performs no reads, sends, or receipt allocation", async () => {
    const draft = input()
    const remote = transport(draft.directory)
    const result = await reply({ ...draft, send: false }, remote.run)
    expect(result.status).toBe("preview")
    expect(remote.calls).toHaveLength(0)
    expect(existsSync(path.join(draft.directory, "outbox"))).toBe(false)
  })

  test("writes intent before sending and saves key, message ID, and private permissions", async () => {
    const draft = input()
    const remote = transport(draft.directory)
    const result = await reply(draft, remote.run)
    expect(result.status).toBe("sent")
    const receipts = await readReceipts(draft.directory)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({
      key: `${draft.task.id}-阻碍-1`,
      sequence: 1,
      messageId: "om_sent_1",
      status: "sent",
      event: draft.event,
      text: draft.text,
    })
    expect(statSync(receipts[0].file).mode & 0o777).toBe(0o600)
    expect(statSync(path.join(draft.directory, "outbox", "replies")).mode & 0o777).toBe(0o700)
    expect(remote.calls[0].at(-1)).toBe("user")
    expect(remote.calls[1].at(-1)).toBe("bot")
  })

  test("repeating the same event returns its receipt without another remote call", async () => {
    const draft = input()
    const remote = transport(draft.directory)
    const first = await reply(draft, remote.run)
    const count = remote.calls.length
    const second = await reply(draft, remote.run)
    expect(second).toEqual(first)
    expect(remote.calls).toHaveLength(count)
  })

  test("concurrent claims submit only one notification", async () => {
    const draft = input()
    const remote = transport(draft.directory)
    const results = await Promise.allSettled([reply(draft, remote.run), reply(draft, remote.run)])
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(remote.calls.filter((argv) => argv[1] === "im")).toHaveLength(1)
    expect(await readReceipts(draft.directory)).toHaveLength(1)
    expect(
      readdirSync(path.join(draft.directory, "outbox", "replies")).filter((name) => name.endsWith(".lock")),
    ).toHaveLength(0)
  })

  test("timeouts persist unknown and block both retry and a new event beyond the API window", async () => {
    const draft = input()
    const remote = transport(draft.directory, "timeout")
    await expect(reply(draft, remote.run)).rejects.toThrow("outcome is unknown")
    const receipt = (await readReceipts(draft.directory))[0]
    expect(receipt.status).toBe("unknown")
    await Bun.write(receipt.file, JSON.stringify({ ...receipt, attemptedAt: "2020-01-01T00:00:00.000Z" }))
    const count = remote.calls.length
    await expect(reply(draft, remote.run)).rejects.toThrow("requires reconciliation")
    await expect(reply({ ...draft, event: "different-blocker", text: "另一个阻碍。" }, remote.run)).rejects.toThrow(
      "requires reconciliation",
    )
    expect(remote.calls).toHaveLength(count)
    expect(await readReceipts(draft.directory)).toHaveLength(1)
  })

  test("a successful new event increments once; retries reuse its key", async () => {
    const draft = input()
    const remote = transport(draft.directory)
    await reply(draft, remote.run)
    const changed = { ...draft, event: "configuration-resolved", text: "配置已补齐，继续处理。" }
    await reply(changed, remote.run)
    await reply(changed, remote.run)
    expect((await readReceipts(draft.directory)).map((entry) => entry.sequence).sort()).toEqual([1, 2])
    expect(
      remote.calls.filter((argv) => argv[1] === "im").map((argv) => argv[argv.indexOf("--idempotency-key") + 1]),
    ).toEqual([`${draft.task.id}-阻碍-1`, `${draft.task.id}-阻碍-2`])
  })

  test("the real subprocess timeout settles as unknown and blocks another submission", async () => {
    const draft = input()
    const remote = transport(draft.directory)
    const submissions: string[][] = []
    const marker = path.join(draft.directory, "submitted")
    const run: ReplyRunner = (argv) => {
      if (argv[1] !== "im") return remote.run(argv)
      submissions.push(argv)
      return executeReply(
        [
          process.execPath,
          "-e",
          `await Bun.write(${JSON.stringify(marker)}, "submitted"); await new Promise(() => {});`,
        ],
        2000,
      )
    }
    await expect(reply(draft, run)).rejects.toThrow("outcome is unknown")
    expect(existsSync(marker)).toBe(true)
    expect((await readReceipts(draft.directory))[0].status).toBe("unknown")
    await expect(reply(draft, run)).rejects.toThrow("requires reconciliation")
    expect(submissions).toHaveLength(1)
  })

  test("the event payload cannot be changed to bypass deduplication", async () => {
    const draft = input()
    const remote = transport(draft.directory)
    await reply(draft, remote.run)
    const count = remote.calls.length
    await expect(reply({ ...draft, text: "Changed text" }, remote.run)).rejects.toThrow("different target or text")
    expect(remote.calls).toHaveLength(count)
  })

  test("an unknown result blocks a different task pointing at the same target", async () => {
    const draft = input()
    const remote = transport(draft.directory, "timeout")
    await expect(reply(draft, remote.run)).rejects.toThrow("outcome is unknown")
    const count = remote.calls.length
    await expect(reply({ ...draft, task: { ...draft.task, id: "task-alternate" } }, remote.run)).rejects.toThrow(
      "requires reconciliation",
    )
    expect(remote.calls).toHaveLength(count)
  })

  test("an incomplete successful response is unknown and is not resent", async () => {
    const draft = input()
    const remote = transport(draft.directory, "missing-id")
    await expect(reply(draft, remote.run)).rejects.toThrow("outcome is unknown")
    expect((await readReceipts(draft.directory))[0].status).toBe("unknown")
    await expect(reply(draft, remote.run)).rejects.toThrow("requires reconciliation")
    expect(remote.calls.filter((argv) => argv[1] === "im")).toHaveLength(1)
  })

  test("postLark permission is checked before any API access", async () => {
    const draft = input()
    const remote = transport(draft.directory)
    await expect(
      reply({ ...draft, config: { ...draft.config, permissions: { postLark: false } } }, remote.run),
    ).rejects.toThrow("not authorized")
    expect(remote.calls).toHaveLength(0)
  })

  test("task source cannot override the configured target", async () => {
    const draft = input()
    const remote = transport(draft.directory)
    const task = {
      ...draft.task,
      item: {
        ...draft.task.item,
        body: JSON.stringify({ chat_id: "oc_other", message: { message_id: "om_original" } }),
      },
    }
    await expect(reply({ ...draft, task }, remote.run)).rejects.toThrow("does not match")
    expect(remote.calls).toHaveLength(0)
  })

  test("live original-message ownership is checked before sending", async () => {
    const draft = input()
    const remote = transport(draft.directory, "wrong-chat")
    await expect(reply(draft, remote.run)).rejects.toThrow("does not match")
    expect(remote.calls.filter((argv) => argv[1] === "im")).toHaveLength(0)
    expect(await readReceipts(draft.directory)).toHaveLength(0)
  })

  test("Bot membership is checked before intent or dispatch", async () => {
    const draft = input()
    const remote = transport(draft.directory, "not-member")
    await expect(reply(draft, remote.run)).rejects.toThrow("must join")
    expect(remote.calls.filter((argv) => argv[1] === "im")).toHaveLength(0)
    expect(await readReceipts(draft.directory)).toHaveLength(0)
  })
})
