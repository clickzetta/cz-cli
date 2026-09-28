import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AppProcess } from "@opencode-ai/core/process"
import { createConnection, createServer } from "node:net"
import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { createSqlSupervisor } from "../src/sql/cleanup-scope.js"

const execModule = new URL("../src/commands/exec.ts", import.meta.url).pathname
function program(url: string, options = "{ timeoutMs: 30000 }") {
  return `import { execSql } from ${JSON.stringify(execModule)};
    import { anonymous } from '@clickzetta/sdk';
    const ctx = { config: { workspace: 'ws', schema: 'public', vcluster: 'vc', instance: 'inst' },
      clientOpts: { baseUrl: ${JSON.stringify(url)}, tokens: anonymous() }, instanceId: () => 1 };
    await execSql(ctx, 'select 1', ${options});`
}

async function until(predicate: () => boolean, timeout = 5000) {
  const deadline = performance.now() + timeout
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error("condition did not become true")
    await Bun.sleep(10)
  }
}

function queryServer(stage: "submit" | "poll" = "poll") {
  const submitted: string[] = []
  const cancelled: string[] = []
  const active = new Set<string>()
  const timeouts: (number | undefined)[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = await request.json()
      if (request.url.endsWith("submitJob")) {
        const id = body.jobDesc.jobId.id
        submitted.push(id)
        timeouts.push(body.jobDesc.jobTimeoutMs)
        active.add(id)
        if (stage === "submit") return new Promise<Response>(() => {})
        return Response.json({ status: { state: "RUNNING" } })
      }
      if (request.url.endsWith("cancelJob")) {
        cancelled.push(body.job_id.id)
        active.delete(body.job_id.id)
        return Response.json({})
      }
      return Response.json({ status: { state: active.has(body.getResultRequest.jobId.id) ? "RUNNING" : "CANCELLED" } })
    },
  })
  return { server, submitted, cancelled, active, timeouts }
}

for (const stage of ["submit", "poll"] as const) {
  test(`SIGKILL during ${stage} triggers disconnect cleanup without touching another connection`, async () => {
    const remote = queryServer(stage)
    const warnings: unknown[] = []
    const supervisor = await createSqlSupervisor({
      onWarning: async (warning) => {
        warnings.push(warning)
      },
    })
    const children = [1, 2].map(() =>
      Bun.spawn([process.execPath, "--eval", program(remote.server.url.origin)], {
        env: { ...process.env, ...supervisor.env },
        stdout: "pipe",
        stderr: "pipe",
      }),
    )
    try {
      await until(() => remote.submitted.length === 2)
      children[0].kill("SIGKILL")
      await children[0].exited
      // No shell hook, no explicit supervisor.close(): socket death drives cleanup.
      await until(() => remote.cancelled.length === 1)
      expect(remote.active.size).toBe(1)
      await Bun.sleep(100)
      expect(remote.cancelled).toHaveLength(1)
      children[1].kill("SIGKILL")
      await children[1].exited
      await until(() => remote.active.size === 0)
      expect(new Set(remote.cancelled).size).toBe(2)
      expect(warnings).toEqual([])
    } finally {
      children.forEach((child) => child.kill("SIGKILL"))
      await Promise.all(children.map((child) => child.exited))
      await supervisor.close()
      await remote.server.stop(true)
    }
  }, 15000)
}

test("explicit async handoff survives child exit and supervisor shutdown", async () => {
  const remote = queryServer()
  const supervisor = await createSqlSupervisor({ onWarning: async () => {} })
  const child = Bun.spawn(
    [process.execPath, "--eval", program(remote.server.url.origin, "{ timeoutMs: 30000, asynchronous: true }")],
    {
      env: { ...process.env, ...supervisor.env },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  try {
    const code = await child.exited
    expect({ code, error: code ? await new Response(child.stderr).text() : "" }).toEqual({ code: 0, error: "" })
    await supervisor.close()
    expect(remote.cancelled).toEqual([])
    expect(remote.timeouts).toEqual([30000])
  } finally {
    child.kill("SIGKILL")
    await child.exited
    await supervisor.close()
    await remote.server.stop(true)
  }
})

test("unavailable supervisor prevents submission", async () => {
  const remote = queryServer()
  const supervisor = await createSqlSupervisor({ onWarning: async () => {} })
  await supervisor.close()
  const child = Bun.spawn([process.execPath, "--eval", program(remote.server.url.origin)], {
    env: { ...process.env, ...supervisor.env },
    stdout: "pipe",
    stderr: "pipe",
  })
  try {
    expect(await child.exited).not.toBe(0)
    expect(remote.submitted).toEqual([])
  } finally {
    child.kill("SIGKILL")
    await child.exited
    await remote.server.stop(true)
  }
})

async function register(env: { CZ_SQL_CLEANUP: string }, baseUrl: string, id = "owned", timeoutMs = 30000) {
  const address = JSON.parse(env.CZ_SQL_CLEANUP)
  const url = new URL(address.url)
  const socket = createConnection({ host: url.hostname, port: Number(url.port) })
  const ready = Promise.withResolvers<void>()
  const timer = setTimeout(() => {
    socket.destroy()
    ready.reject(new Error("registration timed out"))
  }, 2000)
  socket.on("connect", () =>
    socket.write(
      JSON.stringify({
        type: "register",
        secret: address.secret,
        job: { id, workspace: "ws", instanceId: 1 },
        baseUrl,
        credential: { token: "private-token", instanceId: 1, userId: 1 },
        timeoutMs,
      }) + "\n",
    ),
  )
  socket.on("data", () => ready.resolve())
  socket.on("close", () => ready.reject(new Error("registration rejected")))
  socket.on("error", () => ready.reject(new Error("registration failed")))
  try {
    await ready.promise
    return socket
  } finally {
    clearTimeout(timer)
  }
}

for (const expiry of ["heartbeat", "deadline"] as const) {
  test(`${expiry} expiry cancels a still-connected job`, async () => {
    const remote = queryServer()
    remote.active.add("owned")
    const supervisor = await createSqlSupervisor({
      heartbeatMs: 20,
      heartbeatTimeoutMs: expiry === "heartbeat" ? 100 : 1000,
      onWarning: async () => {},
    })
    const socket = await register(
      supervisor.env,
      remote.server.url.origin,
      "owned",
      expiry === "deadline" ? 100 : 30000,
    )
    try {
      await until(() => remote.cancelled.length > 0)
      expect(remote.cancelled).toEqual(["owned"])
      expect(remote.active.size).toBe(0)
    } finally {
      socket.destroy()
      await supervisor.close()
      await remote.server.stop(true)
    }
  })
}

test("healthy heartbeats keep a long-running query alive", async () => {
  const remote = queryServer("submit")
  const supervisor = await createSqlSupervisor({ heartbeatMs: 20, heartbeatTimeoutMs: 300, onWarning: async () => {} })
  const child = Bun.spawn([process.execPath, "--eval", program(remote.server.url.origin)], {
    env: { ...process.env, ...supervisor.env },
    stdout: "pipe",
    stderr: "pipe",
  })
  try {
    await until(() => remote.submitted.length === 1)
    await Bun.sleep(700)
    expect(remote.cancelled).toEqual([])
    child.kill("SIGKILL")
    await child.exited
    await until(() => remote.cancelled.length === 1)
  } finally {
    child.kill("SIGKILL")
    await child.exited
    await supervisor.close()
    await remote.server.stop(true)
  }
})

test("wrong capability cannot register a job", async () => {
  const remote = queryServer()
  const supervisor = await createSqlSupervisor({ onWarning: async () => {} })
  const address = JSON.parse(supervisor.env.CZ_SQL_CLEANUP)
  try {
    await expect(
      register(
        { CZ_SQL_CLEANUP: JSON.stringify({ ...address, secret: crypto.randomUUID() }) },
        remote.server.url.origin,
      ),
    ).rejects.toThrow("rejected")
    expect(remote.cancelled).toEqual([])
  } finally {
    await supervisor.close()
    await remote.server.stop(true)
  }
})

test("cleanup reports unconfirmed job IDs within its budget without leaking credentials", async () => {
  const warnings: { jobId: string; reason: string }[] = []
  const server = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) })
  const supervisor = await createSqlSupervisor({
    cleanupTimeoutMs: 150,
    onWarning: async (warning) => {
      warnings.push(warning)
    },
  })
  const socket = await register(supervisor.env, server.url.origin)
  try {
    const start = performance.now()
    socket.destroy()
    await until(() => warnings.length === 1)
    expect(performance.now() - start).toBeLessThan(1500)
    expect(warnings[0].jobId).toBe("owned")
    expect(JSON.stringify(warnings)).not.toContain("private-token")
    await supervisor.close()
    await supervisor.close()
  } finally {
    socket.destroy()
    await supervisor.close()
    await server.stop(true)
  }
})

test("lost async acknowledgement fails the command and cancels the submitted job", async () => {
  const remote = queryServer()
  const server = createServer((socket) => {
    socket.on("error", () => {})
    socket.on("data", (data) => {
      for (const line of data.toString().trim().split("\n")) {
        const message = JSON.parse(line)
        if (message.type === "register")
          socket.write(JSON.stringify({ type: "registered", heartbeatMs: 1000, heartbeatTimeoutMs: 10000 }) + "\n")
        if (message.type === "release") socket.destroy()
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("missing address")
  const child = Bun.spawn(
    [process.execPath, "--eval", program(remote.server.url.origin, "{ timeoutMs: 30000, asynchronous: true }")],
    {
      env: {
        ...process.env,
        CZ_SQL_CLEANUP: JSON.stringify({ url: `tcp://127.0.0.1:${address.port}`, secret: crypto.randomUUID() }),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  try {
    expect(await child.exited).not.toBe(0)
    expect(remote.submitted).toHaveLength(1)
    expect(remote.cancelled).toEqual(remote.submitted)
    const stderr = await new Response(child.stderr).text()
    expect(stderr).toContain("async handoff acknowledgement failed")
    expect(stderr).toContain(remote.submitted[0])
  } finally {
    child.kill("SIGKILL")
    await child.exited
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await remote.server.stop(true)
  }
})

test("bundled cz bootstrap passes supervision to children through inherited environment", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cz-supervisor-"))
  const remote = queryServer("submit")
  const previous = process.env.CZ_SQL_CLEANUP
  try {
    const build = await Bun.build({
      entrypoints: [new URL("../src/sql/supervisor-runtime.ts", import.meta.url).pathname],
      target: "bun",
      format: "esm",
      outdir: directory,
    })
    expect(build.success).toBe(true)
    const runtime: typeof import("../src/sql/supervisor-runtime.js") = await import(
      pathToFileURL(build.outputs[0].path).href
    )
    let endpoint = ""
    await runtime.withSqlSupervisor(async () => {
      endpoint = JSON.parse(process.env.CZ_SQL_CLEANUP!).url
      const child = Bun.spawn([process.execPath, "--eval", program(remote.server.url.origin)], {
        env: { ...process.env },
        stdout: "pipe",
        stderr: "pipe",
      })
      try {
        await until(() => remote.submitted.length === 1)
        child.kill("SIGKILL")
        await child.exited
        await until(() => remote.cancelled.length === 1)
      } finally {
        child.kill("SIGKILL")
        await child.exited
      }
    })
    expect(process.env.CZ_SQL_CLEANUP).toBe(previous)
    const url = new URL(endpoint)
    const probe = createConnection({ host: url.hostname, port: Number(url.port) })
    await new Promise<void>((resolve) => probe.once("error", () => resolve()))
    probe.destroy()
  } finally {
    await remote.server.stop(true)
    await rm(directory, { recursive: true, force: true })
  }
}, 15000)

test("unmodified upstream process runner inherits supervision and cancels after timeout", async () => {
  const { withSqlSupervisor } = await import("../src/sql/supervisor-runtime.js")
  const remote = queryServer("submit")
  try {
    await withSqlSupervisor(async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const processService = yield* AppProcess.Service
          yield* processService
            .run(
              ChildProcess.make(process.execPath, ["--eval", program(remote.server.url.origin)], {
                killSignal: "SIGKILL",
              }),
              { timeout: "1 second" },
            )
            .pipe(Effect.ignore)
        }).pipe(Effect.provide(AppProcess.defaultLayer)),
      )
      expect(remote.submitted).toHaveLength(1)
      await until(() => remote.cancelled.length === 1)
    })
  } finally {
    await remote.server.stop(true)
  }
})

test("existing cz Worker environment bridge carries the supervisor endpoint", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cz-supervisor-worker-"))
  await Bun.write(path.join(directory, "worker.ts"), "postMessage(process.env.CZ_SQL_CLEANUP); close();")
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
    import { withSqlSupervisor } from ${JSON.stringify(new URL("../src/sql/supervisor-runtime.ts", import.meta.url).pathname)};
    import { installClickzettaWorkerEnvShim } from ${JSON.stringify(new URL("../src/bootstrap/runtime-config.ts", import.meta.url).pathname)};
    await withSqlSupervisor(async () => {
      installClickzettaWorkerEnvShim();
      const worker = new Worker(${JSON.stringify(path.join(directory, "worker.ts"))});
      try {
        const value = await new Promise((resolve, reject) => { worker.onmessage = e => resolve(e.data); worker.onerror = reject; });
        console.log(JSON.stringify({ inherited: value === process.env.CZ_SQL_CLEANUP, protocol: JSON.parse(value).url.startsWith('tcp:') }));
      } finally { await worker.terminate(); }
    });
  `,
    ],
    { env: { ...process.env }, stdout: "pipe", stderr: "pipe" },
  )
  try {
    const code = await child.exited
    expect({ code, error: code ? await new Response(child.stderr).text() : "" }).toEqual({ code: 0, error: "" })
    expect(JSON.parse(await new Response(child.stdout).text())).toEqual({ inherited: true, protocol: true })
  } finally {
    child.kill("SIGKILL")
    await child.exited
    await rm(directory, { recursive: true, force: true })
  }
})

test("supervisor startup failure leaves non-SQL work usable but blocks SQL admission", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cz-supervisor-unavailable-"))
  await Bun.write(path.join(directory, ".clickzetta"), "not a directory")
  const remote = queryServer()
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
    import { withSqlSupervisor } from ${JSON.stringify(new URL("../src/sql/supervisor-runtime.ts", import.meta.url).pathname)};
    await withSqlSupervisor(async () => {
      console.log('non-sql-work-ran');
      const { execSql } = await import(${JSON.stringify(execModule)});
      const { anonymous } = await import('@clickzetta/sdk');
      await execSql({ config: { workspace: 'ws', schema: 'public', vcluster: 'vc', instance: 'inst' },
        clientOpts: { baseUrl: ${JSON.stringify(remote.server.url.origin)}, tokens: anonymous() }, instanceId: () => 1 }, 'select 1');
    });
  `,
    ],
    { env: { ...process.env, CLICKZETTA_TEST_HOME: directory }, stdout: "pipe", stderr: "pipe" },
  )
  try {
    expect(await child.exited).not.toBe(0)
    expect(await new Response(child.stdout).text()).toContain("non-sql-work-ran")
    expect(await new Response(child.stderr).text()).toContain("SQL cleanup supervisor unavailable")
    expect(remote.submitted).toEqual([])
  } finally {
    child.kill("SIGKILL")
    await child.exited
    await remote.server.stop(true)
    await rm(directory, { recursive: true, force: true })
  }
})
