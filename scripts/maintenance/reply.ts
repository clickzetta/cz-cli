import { createHash, randomUUID } from "node:crypto"
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"

export type ReplyPhase = "接单" | "阻碍" | "审查完成" | "发布完成"

export type ReplyInput = {
  directory: string
  config: {
    permissions: { postLark: boolean }
    lark: { chatId?: string; identity?: "user" | "bot"; sendIdentity?: "user" | "bot" }
  }
  task: { id: string; item: { source: string; id: string; body: string } }
  phase: ReplyPhase
  event: string
  text: string
  send?: boolean
}

export type ReplyReceipt = {
  taskId: string
  phase: ReplyPhase
  event: string
  sequence: number
  key: string
  chatId: string
  targetMessageId: string
  text: string
  identity: "bot"
  status: "sending" | "sent" | "unknown"
  attemptedAt: string
  messageId?: string
  sentAt?: string
  error?: string
}

export type ReplyRunner = (argv: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>

export async function reply(input: ReplyInput, run: ReplyRunner = executeReply) {
  const draft = requireDraft(input)
  if (!input.send) return { status: "preview" as const, ...draft }
  if (input.config.permissions.postLark !== true) throw new Error("Bot replies are not authorized: postLark is false")
  const folder = path.join(input.directory, "outbox", "replies")
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  const lock = path.join(folder, `${hash([draft.chatId, draft.targetMessageId])}.lock`)
  closeSync(openSync(lock, "wx", 0o600))
  try {
    const receipts = await readReceipts(input.directory)
    const previous = receipts.find(
      (entry) => entry.taskId === draft.taskId && entry.phase === draft.phase && entry.event === draft.event,
    )
    if (previous) {
      if (
        previous.chatId !== draft.chatId ||
        previous.targetMessageId !== draft.targetMessageId ||
        previous.text !== draft.text
      )
        throw new Error("An existing notification event has a different target or text; preserve its original payload")
      if (previous.status === "sent") return previous
      throw new Error(`Notification requires reconciliation (${previous.status}): ${previous.file}`)
    }
    const unresolved = receipts.find(
      (entry) =>
        entry.chatId === draft.chatId && entry.targetMessageId === draft.targetMessageId && entry.status !== "sent",
    )
    if (unresolved)
      throw new Error(`An earlier notification to this target requires reconciliation: ${unresolved.file}`)

    const original = await request(
      ["lark-cli", "api", "GET", `/open-apis/im/v1/messages/${draft.targetMessageId}`, "--as", "user"],
      "user",
      run,
    )
    if (!Array.isArray(original.items) || original.items.length !== 1 || !record(original.items[0]))
      throw new Error("Lark did not return exactly one original message")
    if (
      original.items[0].message_id !== draft.targetMessageId ||
      original.items[0].chat_id !== draft.chatId ||
      original.items[0].deleted === true
    )
      throw new Error("Original message does not match the bound chat and message")
    const membership = await request(
      ["lark-cli", "api", "GET", `/open-apis/im/v1/chats/${draft.chatId}/members/is_in_chat`, "--as", "bot"],
      "bot",
      run,
    )
    if (membership.is_in_chat !== true) throw new Error("Bot must join the bound chat before sending")

    const sequence =
      Math.max(
        0,
        ...receipts
          .filter((entry) => entry.taskId === draft.taskId && entry.phase === draft.phase)
          .map((entry) => entry.sequence),
      ) + 1
    const receipt: ReplyReceipt = {
      ...draft,
      sequence,
      key: `${draft.taskId}-${draft.phase}-${sequence}`,
      status: "sending",
      attemptedAt: new Date().toISOString(),
    }
    const file = path.join(folder, `${hash([receipt.taskId, receipt.phase, receipt.event])}.json`)
    // Write intent before the remote side effect. The API key deduplicates for only one hour.
    save(file, receipt)
    try {
      const sent = await request(
        [
          "lark-cli",
          "im",
          "+messages-reply",
          "--as",
          "bot",
          "--message-id",
          receipt.targetMessageId,
          "--reply-in-thread",
          "--idempotency-key",
          receipt.key,
          "--text",
          receipt.text,
          "--json",
        ],
        "bot",
        run,
      )
      if (
        typeof sent.message_id !== "string" ||
        !/^om_[\w-]+$/.test(sent.message_id) ||
        sent.chat_id !== receipt.chatId
      )
        throw new Error("Lark returned no valid message ID or matching chat ID")
      const completed: ReplyReceipt = {
        ...receipt,
        status: "sent",
        messageId: sent.message_id,
        sentAt: new Date().toISOString(),
      }
      save(file, completed)
      return { ...completed, file }
    } catch (error) {
      save(file, { ...receipt, status: "unknown", error: error instanceof Error ? error.message : String(error) })
      throw new Error(`Notification outcome is unknown; reconcile before another send: ${file}`)
    }
  } finally {
    rmSync(lock)
  }
}

export async function readReceipts(directory: string) {
  const folder = path.join(directory, "outbox", "replies")
  if (!existsSync(folder)) return []
  return Promise.all(
    readdirSync(folder)
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => ({
        ...requireReceipt(await Bun.file(path.join(folder, name)).json()),
        file: path.join(folder, name),
      })),
  )
}

function requireDraft(input: ReplyInput) {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(input.task.id)) throw new Error("Invalid maintenance task ID")
  if (input.task.item.source !== "lark") throw new Error("Only a Lark source task can receive a Bot reply")
  if (!phases.includes(input.phase) || !input.event.trim() || input.event.length > 1000)
    throw new Error("A valid notification phase and stable event ID are required")
  if (!input.text.trim() || Buffer.byteLength(JSON.stringify({ text: input.text }), "utf8") > 150_000)
    throw new Error("Notification text is empty or too large")
  if (/<\s*at(?:\s|>)/i.test(input.text) || /[@＠](?:all(?![\w])|所有人|全体成员)/i.test(input.text))
    throw new Error("Notification text must not include mentions")
  if (input.config.lark.identity !== "user" || input.config.lark.sendIdentity !== "bot")
    throw new Error("Maintenance replies require user reads and Bot sends")
  if (!input.config.lark.chatId || !/^oc_[\w-]+$/.test(input.config.lark.chatId))
    throw new Error("Bind a Lark chat before replying")
  const source: unknown = JSON.parse(input.task.item.body)
  if (
    !record(source) ||
    !record(source.message) ||
    source.chat_id !== input.config.lark.chatId ||
    (source.message.chat_id !== undefined && source.message.chat_id !== input.config.lark.chatId) ||
    typeof source.message.message_id !== "string" ||
    !/^om_[\w-]+$/.test(source.message.message_id) ||
    input.task.item.id !== `lark:${input.config.lark.chatId}:${source.message.message_id}`
  )
    throw new Error("Task source does not match the bound chat and message")
  return {
    taskId: input.task.id,
    phase: input.phase,
    event: input.event,
    text: input.text,
    chatId: input.config.lark.chatId,
    targetMessageId: source.message.message_id,
    identity: "bot" as const,
  }
}

const phases: ReplyPhase[] = ["接单", "阻碍", "审查完成", "发布完成"]

function requireReceipt(value: unknown): ReplyReceipt {
  if (
    !record(value) ||
    typeof value.taskId !== "string" ||
    !/^[A-Za-z0-9_-]{1,160}$/.test(value.taskId) ||
    !phases.includes(value.phase as ReplyPhase) ||
    typeof value.event !== "string" ||
    !value.event.trim() ||
    !Number.isSafeInteger(value.sequence) ||
    Number(value.sequence) < 1 ||
    value.key !== `${value.taskId}-${value.phase}-${value.sequence}` ||
    typeof value.chatId !== "string" ||
    !/^oc_[\w-]+$/.test(value.chatId) ||
    typeof value.targetMessageId !== "string" ||
    !/^om_[\w-]+$/.test(value.targetMessageId) ||
    typeof value.text !== "string" ||
    value.identity !== "bot" ||
    !["sending", "sent", "unknown"].includes(String(value.status)) ||
    typeof value.attemptedAt !== "string" ||
    (value.status === "sent" && (typeof value.messageId !== "string" || !/^om_[\w-]+$/.test(value.messageId)))
  )
    throw new Error("Invalid outbox receipt; reconcile it before sending")
  return value as ReplyReceipt
}

async function request(argv: string[], identity: "user" | "bot", run: ReplyRunner) {
  const result = await run(argv)
  if (result.exitCode !== 0) throw new Error(`lark-cli exited ${result.exitCode}: ${result.stderr.slice(0, 600)}`)
  return response(JSON.parse(result.stdout), identity)
}

function response(value: unknown, identity: "user" | "bot", success = false): Record<string, unknown> {
  if (!record(value)) throw new Error("Invalid Lark response")
  if (value.ok === false || ("code" in value && value.code !== 0) || value.error)
    throw new Error("Lark rejected the request")
  if (typeof value.identity === "string" && value.identity !== identity) throw new Error("Lark identity mismatch")
  const accepted = success || value.ok === true || value.code === 0
  if (record(value.data)) return response(value.data, identity, accepted)
  if (!accepted) throw new Error("Lark response has no explicit success status")
  return value
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function hash(value: string[]) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function save(file: string, value: ReplyReceipt) {
  const temporary = `${file}.${randomUUID()}.tmp`
  const descriptor = openSync(temporary, "wx", 0o600)
  try {
    writeFileSync(descriptor, JSON.stringify(value, null, 2) + "\n")
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  renameSync(temporary, file)
  const directory = openSync(path.dirname(file), "r")
  try {
    fsyncSync(directory)
  } finally {
    closeSync(directory)
  }
}

const requestTimeoutMs = 30_000

export async function executeReply(argv: string[], timeoutMs = requestTimeoutMs) {
  const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", timeout: timeoutMs })
  const result = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { stdout: result[0], stderr: result[1], exitCode: result[2] }
}
