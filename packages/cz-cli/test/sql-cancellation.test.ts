import { expect, test } from "bun:test"

test("query deadline aborts a blocked submit and confirms cancellation", async () => {
  const cancelled: string[] = []
  const submitted: string[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = await request.json()
      if (request.url.endsWith("submitJob")) {
        submitted.push(body.jobDesc.jobId.id)
        expect(body.jobDesc.jobTimeoutMs).toBe(150)
        return new Promise<Response>(() => {})
      }
      if (request.url.endsWith("cancelJob")) {
        cancelled.push(body.job_id.id)
        return Response.json({})
      }
      return Response.json({ status: { state: "CANCELLED" } })
    },
  })
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `import { execSql } from ${JSON.stringify(new URL("../src/commands/exec.ts", import.meta.url).pathname)};
     import { anonymous } from '@clickzetta/sdk';
     await execSql({ config: { workspace: 'ws', schema: 'public', vcluster: 'vc', instance: 'inst' },
       clientOpts: { baseUrl: ${JSON.stringify(server.url.origin)}, tokens: anonymous() }, instanceId: () => 1 },
       'select 1', { timeoutMs: 150 });`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  )
  try {
    expect(await child.exited).not.toBe(0)
    expect(submitted).toHaveLength(1)
    expect(cancelled).toEqual(submitted)
    expect(await new Response(child.stderr).text()).toContain(`Job ${submitted[0]} timed out`)
  } finally {
    child.kill("SIGKILL")
    await child.exited
    await server.stop(true)
  }
})

// Real child processes and HTTP requests: signal handling must work outside the
// test process, including while a HYBRID submission has not returned yet.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  for (const phase of ["submit", "poll"] as const) {
    test(`${signal} cancels all active jobs during ${phase}`, async () => {
      const submitted: string[] = []
      const cancelled: string[] = []
      const ready = Promise.withResolvers<void>()
      let polls = 0
      const server = Bun.serve({
        port: 0,
        async fetch(request) {
          const body = await request.json()
          if (request.url.endsWith("/lh/submitJob")) {
            submitted.push(body.jobDesc.jobId.id)
            expect(body.jobDesc.jobTimeoutMs).toBe(30000)
            if (phase === "submit") {
              if (submitted.length === 2) ready.resolve()
              return new Promise<Response>(() => {})
            }
            return Response.json({ status: { state: "RUNNING" } })
          }
          if (request.url.endsWith("/lh/cancelJob")) {
            cancelled.push(body.job_id.id)
            return Response.json({ code: "SUCCESS", data: {} })
          }
          if (++polls === 2) ready.resolve()
          return Response.json({ status: { state: cancelled.length ? "CANCELLED" : "RUNNING" } })
        },
      })
      const child = Bun.spawn(
        [
          process.execPath,
          "--eval",
          `
        import { execSql } from ${JSON.stringify(new URL("../src/commands/exec.ts", import.meta.url).pathname)};
        import { anonymous } from "@clickzetta/sdk";
        const ctx = {
          config: { workspace: "ws", schema: "public", vcluster: "vc", instance: "inst" },
          clientOpts: { baseUrl: ${JSON.stringify(server.url.href)}, tokens: anonymous() },
          instanceId: () => 1,
        };
        await Promise.all([execSql(ctx, "select 1", { timeoutMs: 30000 }), execSql(ctx, "select 2", { timeoutMs: 30000 })]);
      `,
        ],
        { stdout: "pipe", stderr: "pipe" },
      )
      try {
        await Promise.race([
          ready.promise,
          Bun.sleep(5000).then(() => {
            throw new Error("SQL did not start")
          }),
        ])
        child.kill(signal)
        expect(await child.exited).toBe(signal === "SIGTERM" ? 143 : 130)
        expect(cancelled.sort()).toEqual(submitted.sort())
        expect(cancelled).toHaveLength(2)
        const output = JSON.parse(await new Response(child.stdout).text())
        expect(output.error).toEqual({
          code: "ABORTED",
          message: signal === "SIGINT" ? "Execution interrupted by user." : "Execution interrupted by SIGTERM.",
        })
        // Single-job job_id stays for existing readers; concurrent jobs also list job_ids.
        expect(submitted).toContain(output.job_id)
        expect(output.job_ids.sort()).toEqual(submitted.sort())
      } finally {
        child.kill("SIGKILL")
        server.stop(true)
      }
    }, 10000)
  }
}

test("detached async jobs release signal handlers", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
    import { execSql } from ${JSON.stringify(new URL("../src/commands/exec.ts", import.meta.url).pathname)};
    import { hasActiveSqlJobs } from ${JSON.stringify(new URL("../src/commands/sql-lifecycle.ts", import.meta.url).pathname)};
    import { anonymous } from "@clickzetta/sdk";
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ status: { state: "RUNNING" } }) });
    const before = process.listenerCount("SIGTERM");
    await execSql({ config: { workspace: "ws", schema: "public", vcluster: "vc", instance: "inst" }, clientOpts: { baseUrl: server.url.href, tokens: anonymous() }, instanceId: () => 1 }, "select 1", { asynchronous: true });
    console.log(JSON.stringify({ active: hasActiveSqlJobs(), listeners: process.listenerCount("SIGTERM") - before }));
    server.stop(true);
  `,
    ],
    { stdout: "pipe", stderr: "pipe" },
  )
  expect(await child.exited).toBe(0)
  expect(JSON.parse(await new Response(child.stdout).text())).toEqual({ active: false, listeners: 0 })
})

test("a stalled cancellation cannot block process shutdown", async () => {
  const ready = Promise.withResolvers<void>()
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      if (request.url.endsWith("/lh/cancelJob")) return new Promise<Response>(() => {})
      ready.resolve()
      return Response.json({ status: { state: "RUNNING" } })
    },
  })
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
    import { execSql } from ${JSON.stringify(new URL("../src/commands/exec.ts", import.meta.url).pathname)};
    import { anonymous } from "@clickzetta/sdk";
    await execSql({ config: { workspace: "ws", schema: "public", vcluster: "vc", instance: "inst" }, clientOpts: { baseUrl: ${JSON.stringify(server.url.href)}, tokens: anonymous() }, instanceId: () => 1 }, "select 1");
  `,
    ],
    { stdout: "pipe", stderr: "pipe" },
  )
  try {
    await Promise.race([
      ready.promise,
      Bun.sleep(5000).then(() => {
        throw new Error("SQL did not start")
      }),
    ])
    child.kill("SIGTERM")
    expect(await child.exited).toBe(143)
    expect(await new Response(child.stderr).text()).toContain("cancellation unconfirmed")
  } finally {
    child.kill("SIGKILL")
    server.stop(true)
  }
}, 10000)
