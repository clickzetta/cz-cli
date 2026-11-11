import { createHash, randomUUID } from "node:crypto"
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { findTask, sourceKey } from "./state"
import type { Config, Item, Task } from "./state"
import { readReceipts } from "./reply"

export type IntakeSource = "feishu" | "github"
export type IntakeRunner = (
  argv: string[],
) => Promise<{ stdout: string; stderr: string; exitCode: number; timedOut?: boolean }>
type Runtime = { directory: string; config: Config; tasks: Task[] }
type Entry = {
  key: string
  kind: string
  id: string
  sourceId: string
  updatedAt: string
  observedAt: string
  body: string
  url: string
  item: Item
  context: unknown
  sender?: unknown
  taskId?: string
}
type Ledger = {
  version: 1
  source: IntakeSource
  fetchedThrough?: string
  processedThrough?: string
  observed: Record<string, string>
  threads: Record<string, { rootId: string; fetchedThrough?: string }>
  eventReceipts: Record<string, string>
  coverage?: { initialRootStart: string | null; allRootsInitiallyScanned: boolean; knownThreads: number }
  pending: string[]
}

export async function scanIntake(
  runtime: Runtime,
  source: IntakeSource,
  run: IntakeRunner = executeIntake,
  now = new Date(),
) {
  return locked(runtime.directory, source, async () => {
    const previous = await ledger(runtime.directory, source)
    const through = now.toISOString()
    const since = new Date(
      previous.fetchedThrough ? Date.parse(previous.fetchedThrough) - 300_000 : now.getTime() - 7 * 86_400_000,
    ).toISOString()
    // No cursor or seen marker changes until every root, old thread and page succeeds.
    const fetched =
      source === "feishu"
        ? await fetchFeishu(runtime, previous, since, through, run)
        : {
            entries: await fetchGithub(runtime, since, through, run),
            threads: previous.threads,
            eventReceipts: previous.eventReceipts,
            coverage: previous.coverage,
          }
    const next: Ledger = {
      ...previous,
      observed: { ...previous.observed },
      threads: fetched.threads,
      eventReceipts: fetched.eventReceipts,
      coverage: fetched.coverage,
      pending: [...previous.pending],
    }
    const candidates = [...new Map(fetched.entries.map((entry) => [entry.key, entry])).values()]
    for (const entry of candidates) {
      const identity = `${entry.kind}:${entry.id}`
      if (next.observed[identity] === entry.key) continue
      const file = entryPath(runtime.directory, source, entry.key)
      if (!existsSync(file)) save(file, entry)
      if (!next.pending.includes(entry.key)) next.pending.push(entry.key)
      next.observed[identity] = entry.key
    }
    next.pending = next.pending.filter((key) => !existsSync(ackPath(runtime.directory, source, key)))
    next.fetchedThrough = through
    if (!next.pending.length) next.processedThrough = through
    save(ledgerPath(runtime.directory, source), next)
    return summarize(runtime.directory, source, next)
  })
}

export async function pendingIntake(directory: string, source: IntakeSource) {
  return summarize(directory, source, await ledger(directory, source))
}

export async function showIntake(directory: string, source: IntakeSource, key: string): Promise<Entry> {
  requireKey(key)
  return Bun.file(entryPath(directory, source, key)).json()
}

export async function acknowledgeIntake(
  runtime: Runtime,
  source: IntakeSource,
  key: string,
  decision: { taskId?: string; note?: string },
) {
  requireKey(key)
  if (!decision.taskId && !decision.note?.trim()) throw new Error("Intake acknowledgement requires --task or --note")
  if (decision.taskId && !runtime.tasks.some((task) => task.id === decision.taskId))
    throw new Error("Unknown acknowledgement task")
  return locked(runtime.directory, source, async () => {
    const current = await ledger(runtime.directory, source)
    const entry = await showIntake(runtime.directory, source, key)
    const task = decision.taskId ? runtime.tasks.find((task) => task.id === decision.taskId) : undefined
    if (task && sourceKey(task.item, runtime.config.repository) !== entry.sourceId)
      throw new Error("Acknowledgement task belongs to a different source")
    const file = ackPath(runtime.directory, source, key)
    const previous = existsSync(file) ? await Bun.file(file).json() : undefined
    if (!previous && !current.pending.includes(key)) throw new Error("Intake event is not pending")
    if (previous && (previous.taskId !== decision.taskId || previous.note !== decision.note))
      throw new Error("Intake event already acknowledged with a different decision")
    const receipt = previous ?? { key, source, ...decision, acknowledgedAt: new Date().toISOString() }
    // The receipt precedes removal, so a crash cannot forget an acknowledged input.
    if (!previous) save(file, receipt)
    current.pending = current.pending.filter((entry) => entry !== key)
    if (!current.pending.length) current.processedThrough = current.fetchedThrough
    save(ledgerPath(runtime.directory, source), current)
    return { status: "acknowledged" as const, ...receipt, pendingCount: current.pending.length }
  })
}

async function fetchFeishu(runtime: Runtime, previous: Ledger, since: string, through: string, run: IntakeRunner) {
  const chat = runtime.config.lark.chatId
  if (!chat) throw new Error("Feishu intake requires lark.chatId")
  const identity = runtime.config.lark.identity
  const ownReplies = new Set(
    (await readReceipts(runtime.directory))
      .filter((receipt) => receipt.status === "sent")
      .map((receipt) => receipt.messageId),
  )
  const hours = runtime.config.lark.lookbackHours
  if (hours !== undefined && (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0))
    throw new Error("lark.lookbackHours must be a positive number when configured")
  const start = previous.fetchedThrough
    ? since
    : typeof hours === "number"
      ? new Date(Date.parse(through) - hours * 3_600_000).toISOString()
      : undefined
  const roots = await larkPages(
    [
      "lark-cli",
      "im",
      "+chat-messages-list",
      "--as",
      identity,
      "--chat-id",
      chat,
      ...(start ? ["--start", start] : []),
      "--end",
      through,
      "--order",
      "asc",
      "--page-size",
      "50",
      "--no-reactions",
      "--json",
    ],
    identity,
    run,
  )
  const threads = structuredClone(previous.threads)
  const eventReceipts = { ...previous.eventReceipts }
  const lookups = new Map(roots.map((message) => [String(message.message_id), message]))
  const standalone = new Map<string, { root: Record<string, unknown>; message: Record<string, unknown> }>()
  const lookup = async (id: string) => {
    const cached = lookups.get(id)
    if (cached) return cached
    const response = await request(["lark-cli", "api", "GET", `/open-apis/im/v1/messages/${id}`, "--as", identity], run)
    if (
      !record(response) ||
      response.ok !== true ||
      (response.identity !== undefined && response.identity !== identity) ||
      !record(response.data) ||
      !Array.isArray(response.data.items) ||
      response.data.items.length !== 1 ||
      !record(response.data.items[0])
    )
      throw new Error("Invalid Feishu message lookup")
    const message = response.data.items[0]
    if (message.chat_id !== chat || message.message_id !== id)
      throw new Error("Feishu lookup returned another message or chat")
    lookups.set(id, message)
    return message
  }
  const remember = async (message: Record<string, unknown>) => {
    const id = requiredString(message, "message_id")
    if (message.chat_id !== chat) throw new Error("Feishu returned a message from another chat")
    const root =
      !canonicalThread(message.thread_id) && typeof message.root_id === "string" && message.root_id !== id
        ? await lookup(message.root_id)
        : message
    const thread = canonicalThread(message.thread_id) ?? canonicalThread(root.thread_id)
    if (thread) {
      threads[thread] ??= { rootId: typeof message.root_id === "string" && message.root_id ? message.root_id : id }
      return
    }
    standalone.set(id, { root, message })
  }
  const received = path.join(runtime.directory, "events", "received")
  for (const filename of existsSync(received) ? readdirSync(received).filter((name) => name.endsWith(".json")) : []) {
    const receipt: unknown = await Bun.file(path.join(received, filename)).json()
    if (
      !record(receipt) ||
      receipt.chatId !== chat ||
      typeof receipt.messageId !== "string" ||
      !/^om_[\w-]+$/.test(receipt.messageId)
    )
      continue
    const fingerprint = createHash("sha256").update(JSON.stringify(receipt)).digest("hex")
    if (eventReceipts[filename] === fingerprint) continue
    await remember(await lookup(receipt.messageId))
    eventReceipts[filename] = fingerprint
  }
  for (const [id, thread] of Object.entries(threads)) {
    if (canonicalThread(id)) continue
    delete threads[id]
    await remember(await lookup(thread.rootId))
  }
  for (const task of runtime.tasks.filter((task) => task.item.source === "lark")) {
    const rootId = task.item.id.match(new RegExp(`^lark:${chat}:(om_[\\w-]+)$`))?.[1]
    if (rootId && !Object.values(threads).some((thread) => thread.rootId === rootId))
      await remember(await lookup(rootId))
  }
  for (const message of roots) await remember(message)
  const entries: Entry[] = []
  const owner = (root: Record<string, unknown>, id: string | null, messages: Record<string, unknown>[]) => {
    const ids = new Set(messages.map((message) => String(message.message_id)))
    if (id)
      lookups.forEach((message) => {
        if (canonicalThread(message.thread_id) === id) ids.add(String(message.message_id))
      })
    return (
      runtime.tasks.find((task) => task.item.source === "lark" && task.item.id === `lark:${chat}:${root.message_id}`) ??
      runtime.tasks.find(
        (task) =>
          task.item.source === "lark" &&
          ids.has(task.item.id.match(new RegExp(`^lark:${chat}:(om_[\\w-]+)$`))?.[1] ?? ""),
      )
    )
  }
  const add = (
    message: Record<string, unknown>,
    root: Record<string, unknown>,
    id: string | null,
    messages: Record<string, unknown>[],
  ) => {
    if (message.chat_id !== chat) throw new Error("Feishu thread returned a message from another chat")
    if (ownReplies.has(String(message.message_id))) return
    const updatedAt = messageTime(message)
    const existing = owner(root, id, messages)
    const bound = existing
      ? (lookups.get(existing.item.id.split(":").at(-1)!) ??
        messages.find((entry) => entry.message_id === existing.item.id.split(":").at(-1)))
      : root
    if (!bound) throw new Error("Cannot resolve the existing task's bound Feishu message")
    const sourceId = existing?.item.id ?? `lark:${chat}:${requiredString(root, "message_id")}`
    const body = text(message)
    const item: Item = {
      source: "lark",
      id: sourceId,
      title: text(root).slice(0, 160),
      body: JSON.stringify({
        chat_id: chat,
        message: bound,
        rootMessage: root,
        threadId: id,
        latestMessage: message,
        threadMessages: messages,
      }),
      url: typeof root.message_app_link === "string" ? root.message_app_link : "",
      updatedAt,
    }
    entries.push(
      makeEntry(
        runtime,
        {
          kind: "lark-message",
          id: requiredString(message, "message_id"),
          updatedAt,
          observedAt: through,
          body,
          url: typeof message.message_app_link === "string" ? message.message_app_link : item.url,
          item,
          context: { root, threadId: id, messages },
          sender: message.sender,
        },
        [updatedAt, body, message.deleted === true],
      ),
    )
  }
  // Thread APIs have no updated-since filter: scan all pages of each known thread,
  // including roots outside the root-message overlap window.
  for (const [id, thread] of Object.entries(threads)) {
    const messages = await larkPages(
      [
        "lark-cli",
        "im",
        "+threads-messages-list",
        "--as",
        identity,
        "--thread",
        id,
        "--order",
        "asc",
        "--page-size",
        "50",
        "--no-reactions",
        "--json",
      ],
      identity,
      run,
    )
    // Lark's thread list can omit the root (and be empty for a new topic).
    // Resolve the actual root from message metadata instead of treating the
    // first reply as the task source.
    let root = await lookup(thread.rootId)
    const ancestors = new Set<string>()
    while (typeof root.root_id === "string" && root.root_id && root.root_id !== root.message_id) {
      if (ancestors.has(root.root_id) || ancestors.size >= 20) throw new Error("Invalid Feishu root ancestry")
      ancestors.add(root.root_id)
      root = await lookup(root.root_id)
    }
    if (canonicalThread(root.thread_id) && root.thread_id !== id)
      throw new Error("Feishu root belongs to another thread")
    root = { ...root, ...messages.find((message) => message.message_id === root.message_id) }
    thread.rootId = requiredString(root, "message_id")
    thread.fetchedThrough = through
    const complete = [root, ...messages.filter((message) => message.message_id !== root.message_id)]
    complete.forEach((message) => add(message, root, id, complete))
  }
  for (const entry of standalone.values())
    add(
      entry.message,
      entry.root,
      null,
      entry.message.message_id === entry.root.message_id ? [entry.root] : [entry.root, entry.message],
    )
  return {
    entries,
    threads,
    eventReceipts,
    coverage: {
      initialRootStart: previous.coverage ? previous.coverage.initialRootStart : (start ?? null),
      allRootsInitiallyScanned: previous.coverage?.allRootsInitiallyScanned ?? !start,
      knownThreads: Object.keys(threads).length,
    },
  }
}

async function fetchGithub(runtime: Runtime, since: string, through: string, run: IntakeRunner) {
  const base = `repos/${runtime.config.repository}`
  const [open, changed, pulls, comments, reviewComments] = await Promise.all([
    githubPages(`${base}/issues?state=open&sort=updated&direction=asc`, run),
    githubPages(`${base}/issues?state=all&sort=updated&direction=asc&since=${encodeURIComponent(since)}`, run),
    githubPages(`${base}/pulls?state=all&sort=updated&direction=desc`, run),
    githubPages(`${base}/issues/comments?sort=updated&direction=asc&since=${encodeURIComponent(since)}`, run),
    githubPages(`${base}/pulls/comments?sort=updated&direction=asc&since=${encodeURIComponent(since)}`, run),
  ])
  const relevant = pulls.filter(
    (pull) =>
      pull.state === "open" ||
      timestamp(pull.updated_at) >= Date.parse(since) ||
      runtime.tasks.some(
        (task) => ["github", "github-pr"].includes(task.item.source) && task.item.id === String(pull.number),
      ),
  )
  const roots = new Map([...open, ...changed, ...relevant].map((entry) => [String(entry.number), entry]))
  const entries: Entry[] = []
  const add = (kind: string, raw: Record<string, unknown>, number: string, version: unknown[]) => {
    if (!/^[1-9]\d*$/.test(number)) throw new Error("GitHub event has no issue or pull number")
    const root = roots.get(number)
    const updatedAt = iso(raw.updated_at ?? raw.submitted_at ?? raw.created_at ?? root?.updated_at)
    const body = typeof raw.body === "string" ? raw.body : ""
    const item: Item = {
      source: relevant.some((pull) => String(pull.number) === number) || root?.pull_request ? "github-pr" : "github",
      id: number,
      title: root ? String(root.title ?? `GitHub #${number}`) : `GitHub #${number}`,
      body: JSON.stringify({ root, event: raw }),
      url: String(raw.html_url ?? root?.html_url ?? ""),
      updatedAt,
    }
    entries.push(
      makeEntry(
        runtime,
        {
          kind,
          id: String(kind === "github-issue" || kind === "github-pr" ? number : raw.id),
          updatedAt,
          observedAt: through,
          body,
          url: item.url,
          item,
          context: { root, event: raw },
          sender: raw.user,
        },
        version,
      ),
    )
  }
  for (const issue of new Map([...open, ...changed].map((entry) => [String(entry.number), entry])).values()) {
    if (!issue.pull_request)
      add("github-issue", issue, String(issue.number), [issue.updated_at, issue.title, issue.body, issue.state])
  }
  relevant.forEach((pull) =>
    add("github-pr", pull, String(pull.number), [
      pull.updated_at,
      pull.title,
      pull.body,
      pull.state,
      record(pull.head) ? pull.head.sha : null,
    ]),
  )
  comments.forEach((comment) =>
    add("github-issue-comment", comment, issueNumber(comment.issue_url), [comment.updated_at, comment.body]),
  )
  reviewComments.forEach((comment) =>
    add("github-review-comment", comment, issueNumber(comment.pull_request_url), [
      comment.updated_at,
      comment.body,
      comment.commit_id,
    ]),
  )
  for (const pull of relevant) {
    const reviews = await githubPages(`${base}/pulls/${pull.number}/reviews`, run)
    reviews.forEach((review) =>
      add("github-review", review, String(pull.number), [
        review.submitted_at,
        review.state,
        review.body,
        review.commit_id,
      ]),
    )
  }
  return entries
}

function makeEntry(runtime: Runtime, entry: Omit<Entry, "key" | "sourceId" | "taskId">, version: unknown[]) {
  const sourceId = sourceKey(entry.item, runtime.config.repository)
  return {
    ...entry,
    sourceId,
    key: createHash("sha256")
      .update(JSON.stringify([entry.kind, entry.id, version]))
      .digest("hex"),
    taskId: findTask(runtime.tasks, sourceId, runtime.config.repository)?.id,
  }
}

async function larkPages(argv: string[], identity: string, run: IntakeRunner) {
  const output: Record<string, unknown>[] = []
  const tokens = new Set<string>()
  for (let page = ""; ; ) {
    const raw = await request(page ? [...argv, "--page-token", page] : argv, run)
    if (
      !record(raw) ||
      raw.ok !== true ||
      (raw.identity !== undefined && raw.identity !== identity) ||
      !record(raw.data)
    )
      throw new Error("Feishu intake returned no explicit success or the wrong identity")
    const rows = raw.data.messages ?? raw.data.items
    if (!Array.isArray(rows) || rows.some((row) => !record(row))) throw new Error("Invalid Feishu message page")
    output.push(...(rows as Record<string, unknown>[]))
    if (raw.data.has_more !== true) return output
    const next = raw.data.page_token ?? raw.data.next_page_token
    if (typeof next !== "string" || !next || tokens.has(next)) throw new Error("Invalid or repeated Feishu page token")
    tokens.add(next)
    if (tokens.size > 1000) throw new Error("Feishu intake pagination exceeded limit")
    page = next
  }
}

async function githubPages(endpoint: string, run: IntakeRunner) {
  const output: Record<string, unknown>[] = []
  for (let page = 1; page <= 1000; page++) {
    const rows = await request(
      ["gh", "api", "--method", "GET", `${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`],
      run,
    )
    if (!Array.isArray(rows) || rows.some((row) => !record(row))) throw new Error("Invalid GitHub intake page")
    output.push(...(rows as Record<string, unknown>[]))
    if (rows.length < 100) return output
  }
  throw new Error("GitHub intake pagination exceeded limit")
}

async function request(argv: string[], run: IntakeRunner): Promise<unknown> {
  const result = await run(argv)
  if (result.exitCode !== 0 || result.timedOut)
    throw new Error(`${argv[0]} intake request failed (exit ${result.exitCode}); cursor unchanged`)
  return JSON.parse(result.stdout)
}

export async function executeIntake(argv: string[], timeoutMs = 45_000) {
  const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" })
  const timeout = { expired: false }
  const timer = setTimeout(() => {
    timeout.expired = true
    child.kill("SIGKILL")
  }, timeoutMs)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return { stdout, stderr, exitCode, timedOut: timeout.expired }
  } finally {
    clearTimeout(timer)
  }
}

async function ledger(directory: string, source: IntakeSource): Promise<Ledger> {
  const file = Bun.file(ledgerPath(directory, source))
  if (!(await file.exists())) return { version: 1, source, observed: {}, threads: {}, eventReceipts: {}, pending: [] }
  const value = await file.json()
  if (
    !record(value) ||
    value.version !== 1 ||
    value.source !== source ||
    !record(value.observed) ||
    !record(value.threads) ||
    !Array.isArray(value.pending) ||
    value.pending.some((key) => typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key))
  )
    throw new Error("Invalid intake ledger; preserve it for reconciliation")
  return { ...value, eventReceipts: record(value.eventReceipts) ? value.eventReceipts : {} } as Ledger
}

async function summarize(directory: string, source: IntakeSource, current: Ledger) {
  const entries = await Promise.all(current.pending.map((key) => showIntake(directory, source, key)))
  const pending = entries
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.key.localeCompare(b.key))
    .slice(0, 50)
    .map((entry) => {
      return {
        key: entry.key,
        kind: entry.kind,
        id: entry.id,
        sourceId: entry.sourceId,
        updatedAt: entry.updatedAt,
        body: entry.body.slice(0, 1200),
        url: entry.url,
        taskId: entry.taskId,
        sender: entry.sender,
        file: entryPath(directory, source, entry.key),
      }
    })
  return {
    source,
    fetchedThrough: current.fetchedThrough ?? null,
    processedThrough: current.processedThrough ?? null,
    pendingCount: current.pending.length,
    hasMore: current.pending.length > pending.length,
    coverage: current.coverage,
    pending,
  }
}

async function locked<T>(directory: string, source: IntakeSource, operation: () => Promise<T>) {
  mkdirSync(path.join(directory, "intake"), { recursive: true, mode: 0o700 })
  const file = path.join(directory, "intake", `${source}.lock`)
  // A kernel lock held by a pipe-bound helper is released even if Bun receives
  // SIGKILL. Keep the inode: deleting a flock file can split concurrent owners.
  const child = Bun.spawn(
    [
      "python3",
      "-u",
      "-c",
      `import fcntl,json,os,sys
fd=os.open(sys.argv[1],os.O_CREAT|os.O_RDWR,0o600)
try: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError: sys.exit(73)
os.ftruncate(fd,0)
os.write(fd,json.dumps({"pid":os.getpid(),"parentPid":int(sys.argv[3]),"nonce":sys.argv[2]}).encode())
os.fsync(fd)
print("ready",flush=True)
sys.stdin.buffer.read(1)
os.close(fd)
`,
      file,
      randomUUID(),
      String(process.pid),
    ],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  )
  const reader = child.stdout.getReader()
  try {
    const ready = { text: "" }
    while (!ready.text.includes("\n")) {
      const part = await reader.read()
      if (part.done) throw new Error(`Intake ${source} already has an owner or its lock helper failed`)
      ready.text += new TextDecoder().decode(part.value)
      if (ready.text.length > 100) throw new Error("Invalid intake lock handshake")
    }
    if (ready.text.trim() !== "ready") throw new Error("Invalid intake lock handshake")
    return await operation()
  } finally {
    reader.releaseLock()
    child.stdin.end()
    await child.exited
  }
}

function save(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${randomUUID()}.tmp`
  const descriptor = openSync(temporary, "wx", 0o600)
  try {
    writeFileSync(descriptor, JSON.stringify(value, null, 2) + "\n")
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  renameSync(temporary, file)
}

function ledgerPath(directory: string, source: IntakeSource) {
  return path.join(directory, "intake", `${source}.json`)
}
function entryPath(directory: string, source: IntakeSource, key: string) {
  return path.join(directory, "intake", "events", source, `${key}.json`)
}
function ackPath(directory: string, source: IntakeSource, key: string) {
  return path.join(directory, "intake", "ack", source, `${key}.json`)
}
function requireKey(key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid intake event key")
}
function requiredString(value: Record<string, unknown>, key: string) {
  if (typeof value[key] !== "string" || !value[key]) throw new Error(`Missing ${key}`)
  return value[key] as string
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
function timestamp(value: unknown) {
  const result = typeof value === "string" ? Date.parse(value) : NaN
  if (!Number.isFinite(result)) throw new Error("Invalid source timestamp")
  return result
}
function iso(value: unknown) {
  return new Date(timestamp(value)).toISOString()
}
function messageTime(message: Record<string, unknown>) {
  const value = message.update_time ?? message.create_time
  return typeof value === "string" && /^\d+$/.test(value)
    ? new Date(Number(value) * (value.length < 12 ? 1000 : 1)).toISOString()
    : iso(value)
}
function text(message: Record<string, unknown>) {
  return typeof message.content === "string"
    ? message.content
    : record(message.body) && typeof message.body.content === "string"
      ? message.body.content
      : JSON.stringify(message.body ?? message.content ?? {})
}
function canonicalThread(value: unknown) {
  return typeof value === "string" && /^omt_[\w-]+$/.test(value) ? value : undefined
}
function issueNumber(url: unknown) {
  if (typeof url !== "string") throw new Error("GitHub comment has no source URL")
  return url.match(/\/(?:issues|pulls)\/(\d+)$/)?.[1] ?? ""
}
