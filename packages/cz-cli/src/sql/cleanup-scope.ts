import { z } from "zod"
import { createServer, createConnection, type Socket } from "node:net"
import { timingSafeEqual } from "node:crypto"
import {
  abortable,
  abortAfter,
  cancelJobAndWait,
  staticTokenSource,
  type ClientOptions,
  type JobID,
} from "@clickzetta/sdk"

export const CLEANUP_ENV = "CZ_SQL_CLEANUP"
const registration = z.object({
  type: z.literal("register"),
  secret: z.string(),
  job: z.object({
    id: z.string().min(1).max(256),
    workspace: z.string().min(1),
    // profile add --verify and setup pass 0 before an instance id is resolved.
    instanceId: z.number().int().nonnegative(),
  }),
  baseUrl: z
    .string()
    .url()
    .refine((url) => ["http:", "https:"].includes(new URL(url).protocol)),
  credential: z.object({
    token: z.string(),
    instanceId: z.number(),
    userId: z.number(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
  customHeaders: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().positive().finite(),
})

type Connection = {
  socket: Socket
  seen: number
  expires: number
  closing: boolean
  entry?: { key: string; job: JobID; client: ClientOptions }
}

/** Own jobs independently of shell hooks. One authenticated connection owns one job. */
export async function createSqlSupervisor(options: {
  heartbeatMs?: number
  heartbeatTimeoutMs?: number
  cleanupTimeoutMs?: number
  onWarning: (warning: { jobId: string; reason: string }) => Promise<void>
}) {
  const secret = crypto.randomUUID()
  const heartbeatMs = options.heartbeatMs ?? 1000
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 10000
  const sockets = new Set<Connection>()
  const jobs = new Set<string>()
  const pending = new Set<Promise<void>>()
  let closing = false
  let completion: Promise<void> | undefined

  function cleanup(connection: Connection) {
    if (connection.closing) {
      connection.socket.destroy()
      return
    }
    connection.closing = true
    sockets.delete(connection)
    connection.socket.destroy()
    const entry = connection.entry
    if (!entry) return
    const work = (async () => {
      try {
        const result = await cancelJobAndWait(entry.client, entry.job, options.cleanupTimeoutMs ?? 5000)
        if (!result.confirmed) await options.onWarning({ jobId: entry.job.id, reason: result.reason })
      } finally {
        jobs.delete(entry.key)
      }
    })()
    pending.add(work)
    // Reporting must not create an unhandled rejection or stop other jobs' cleanup.
    void work.catch(() => {}).finally(() => pending.delete(work))
  }

  const server = createServer((socket) => {
    if (closing || sockets.size + pending.size >= 256) return socket.destroy()
    const connection: Connection = { socket, seen: performance.now(), expires: Infinity, closing: false }
    sockets.add(connection)
    socket.on("error", () => cleanup(connection))
    socket.on("close", () => {
      sockets.delete(connection)
      cleanup(connection)
    })
    readMessages(socket, (message) => {
      if (closing || connection.closing) return cleanup(connection)
      const parsed = z.object({ type: z.string() }).passthrough().safeParse(message)
      if (!parsed.success) return cleanup(connection)
      if (!connection.entry) {
        const result = registration.safeParse(parsed.data)
        if (!result.success || !sameSecret(result.data.secret, secret)) return cleanup(connection)
        const key = JSON.stringify([result.data.job.instanceId, result.data.job.workspace, result.data.job.id])
        if (jobs.has(key)) return cleanup(connection)
        jobs.add(key)
        connection.entry = {
          key,
          job: result.data.job,
          client: {
            baseUrl: result.data.baseUrl,
            tokens: staticTokenSource(result.data.credential),
            customHeaders: result.data.customHeaders,
          },
        }
        connection.expires = performance.now() + result.data.timeoutMs
        connection.seen = performance.now()
        socket.write(JSON.stringify({ type: "registered", heartbeatMs, heartbeatTimeoutMs }) + "\n")
        return
      }
      // Expiry wins over a late heartbeat or handoff.
      if (performance.now() >= connection.expires || performance.now() - connection.seen >= heartbeatTimeoutMs)
        return cleanup(connection)
      if (parsed.data.type === "heartbeat") {
        connection.seen = performance.now()
        socket.write('{"type":"heartbeat"}\n')
        return
      }
      if (parsed.data.type === "release") {
        jobs.delete(connection.entry.key)
        connection.entry = undefined
        connection.closing = true
        socket.end('{"type":"released"}\n')
        return
      }
      cleanup(connection)
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("SQL supervisor did not bind a TCP port")
  const timer = setInterval(
    () => {
      const now = performance.now()
      for (const socket of sockets) {
        if (now >= socket.expires || now - socket.seen >= heartbeatTimeoutMs) cleanup(socket)
      }
    },
    Math.min(heartbeatMs, 1000),
  )
  timer.unref()
  server.unref()
  return {
    env: { [CLEANUP_ENV]: JSON.stringify({ url: `tcp://127.0.0.1:${address.port}`, secret }) },
    close() {
      if (completion) return completion
      closing = true
      clearInterval(timer)
      for (const socket of sockets) cleanup(socket)
      completion = Promise.allSettled([...pending]).then(
        () =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()))
          }),
      )
      return completion
    },
  }
}

function sameSecret(actual: string, expected: string) {
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function parseMessage(data: string): unknown {
  try {
    return JSON.parse(data)
  } catch {
    return undefined
  }
}

/** Registration is acknowledged before submit; disconnect aborts local execution. */
export async function registerSqlCleanup(
  client: ClientOptions,
  job: JobID,
  signal: AbortSignal,
  timeoutMs: number,
  onLost: () => void,
) {
  const raw = process.env[CLEANUP_ENV]
  if (!raw) return
  if (raw === "unavailable")
    throw new Error(
      "SQL cleanup supervisor unavailable; query was not submitted. Check local socket and ~/.clickzetta write permissions.",
    )
  const address = z.object({ url: z.string().url(), secret: z.string().uuid() }).parse(JSON.parse(raw))
  const url = new URL(address.url)
  if (url.hostname !== "127.0.0.1" || url.protocol !== "tcp:" || !url.port)
    throw new Error("Invalid SQL cleanup supervisor")
  // A token refresh is a portal round trip; bound it by the query deadline only.
  // The 2s budget covers the loopback connect and handshake.
  const credential = await abortable(client.tokens.get(), signal)
  const deadline = abortAfter(2000, signal)
  try {
    deadline.signal.throwIfAborted()
    const socket = createConnection({ host: url.hostname, port: Number(url.port) })
    const ready = Promise.withResolvers<void>()
    const released = Promise.withResolvers<void>()
    // Handoff may never be requested. Still observe rejection if the socket dies.
    void released.promise.catch(() => {})
    let acknowledged = false
    let done = false
    let timer: ReturnType<typeof setInterval> | undefined
    let lastSeen = performance.now()
    const abandon = () => {
      if (timer) clearInterval(timer)
      socket.destroy()
    }
    const lost = () => {
      if (done) return
      done = true
      abandon()
      const error = Object.assign(new Error(`SQL job ${job.id}: cleanup supervisor connection lost`), {
        code: "SQL_SUPERVISOR_LOST",
      })
      ready.reject(error)
      released.reject(error)
      if (acknowledged) onLost()
    }
    socket.on("connect", () => {
      socket.write(
        JSON.stringify({
          type: "register",
          secret: address.secret,
          job,
          baseUrl: client.baseUrl,
          credential,
          customHeaders: client.customHeaders,
          timeoutMs,
        }) + "\n",
      )
    })
    socket.on("error", lost)
    socket.on("close", lost)
    readMessages(socket, (message) => {
      const parsed = z
        .object({
          type: z.enum(["registered", "heartbeat", "released"]),
          heartbeatMs: z.number().positive().optional(),
          heartbeatTimeoutMs: z.number().positive().optional(),
        })
        .safeParse(message)
      if (!parsed.success || done) return lost()
      if (parsed.data.type === "registered" && !acknowledged) {
        const heartbeatMs = parsed.data.heartbeatMs
        const heartbeatTimeoutMs = parsed.data.heartbeatTimeoutMs
        if (!heartbeatMs || !heartbeatTimeoutMs) return lost()
        acknowledged = true
        timer = setInterval(() => {
          if (performance.now() - lastSeen >= heartbeatTimeoutMs) return lost()
          if (!socket.destroyed) socket.write('{"type":"heartbeat"}\n')
        }, heartbeatMs)
        ready.resolve()
        return
      }
      if (parsed.data.type === "heartbeat") {
        lastSeen = performance.now()
        return
      }
      if (parsed.data.type === "released") {
        done = true
        if (timer) clearInterval(timer)
        released.resolve()
        socket.destroy()
        return
      }
      lost()
    })
    try {
      await abortable(ready.promise, deadline.signal)
    } catch (error) {
      done = true
      abandon()
      throw error
    }
    return {
      abandon,
      async release() {
        if (done || socket.destroyed) throw new Error("SQL cleanup acknowledgement failed")
        const limit = abortAfter(1000)
        try {
          socket.write('{"type":"release"}\n')
          await abortable(released.promise, limit.signal)
        } finally {
          limit.dispose()
          abandon()
        }
      },
    }
  } finally {
    deadline.dispose()
  }
}

// Bound each newline-delimited UTF-8 frame before parsing; preserve split multibyte characters.
function readMessages(socket: Socket, receive: (message: unknown) => void) {
  let buffer = Buffer.alloc(0)
  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    while (!socket.destroyed) {
      const end = buffer.indexOf(10)
      if (end < 0) break
      if (end > 64 * 1024) return socket.destroy()
      const message = parseMessage(buffer.subarray(0, end).toString("utf8"))
      buffer = buffer.subarray(end + 1)
      receive(message)
    }
    if (buffer.length > 64 * 1024) socket.destroy()
  })
}
