import { afterAll, describe, expect, test } from "bun:test"
import { deflateSync, gzipSync } from "node:zlib"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createSafeFetch } from "../src/bootstrap/http-fetch"

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path.startsWith("/empty/")) {
      return new Response(null, {
        status: Number(path.split("/")[2]),
        headers: { "content-encoding": path.split("/")[3] },
      })
    }
    if (path.endsWith("/models")) return Response.json({ data: [{ id: "test-model" }] })
    if (path.endsWith("/chat/completions")) {
      return new Response("not a compressed stream", { headers: { "content-encoding": "br" } })
    }
    if (path === "/redirect") return Response.redirect(new URL("/br", request.url))
    if (path === "/headers") {
      return Response.json({
        encoding: request.headers.get("accept-encoding"),
        auth: request.headers.get("authorization"),
        method: request.method,
        body: await request.text(),
      })
    }
    if (path === "/stream") {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("data: first\n\n"))
            // The client must be able to consume the first event before EOF.
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    }
    const body =
      path === "/gzip"
        ? gzipSync("decoded")
        : path === "/deflate"
          ? deflateSync("decoded")
          : path === "/nested"
            ? deflateSync(gzipSync("decoded"))
            : Buffer.from("not a compressed stream")
    const encoding =
      path === "/gzip"
        ? "gzip"
        : path === "/deflate"
          ? "deflate"
          : path === "/nested"
            ? "gzip, deflate"
            : path === "/br"
              ? "br"
              : path === "/mixed"
                ? "gzip, Br"
                : path === "/zstd"
                  ? "zstd"
                  : "identity"
    return new Response(body, {
      status: 201,
      statusText: "Created",
      headers: { "content-encoding": encoding, "content-length": String(body.length), "x-test": "retained" },
    })
  },
})
const safeFetch = createSafeFetch(fetch)
const url = (path: string) => new URL(path, server.url)
afterAll(() => server.stop(true))

describe("HTTP decoding boundary (CVE-2026-111497)", () => {
  test.each(["/br", "/mixed", "/zstd", "/redirect"])("rejects %s before decoding any body", async (path) => {
    // Invalid bytes deliberately avoid a vulnerability/exploit payload. An
    // automatic native decoder would fail differently before this guard ran.
    await expect(safeFetch(url(path))).rejects.toThrow("CVE-2026-111497")
  })

  test.each(["/gzip", "/deflate", "/nested"])("decodes %s and preserves Response behavior", async (path) => {
    const response = await safeFetch(url(path))
    response.headers.set("x-added", "cloned")
    const clone = response.clone()
    expect(response.status).toBe(201)
    expect(response.statusText).toBe("Created")
    expect(response.headers.get("x-test")).toBe("retained")
    expect(response.headers.has("content-encoding")).toBe(false)
    expect(response.headers.has("content-length")).toBe(false)
    expect(response.url).toBe(url(path).href)
    expect(clone.url).toBe(response.url)
    expect(clone.headers.get("x-added")).toBe("cloned")
    expect(await response.text()).toBe("decoded")
    expect(await clone.text()).toBe("decoded")
    expect(response.bodyUsed).toBe(true)
  })

  test.each(["/gzip", "/deflate", "/br"])("preserves HEAD response metadata for %s", async (path) => {
    for (const input of [url(path), new Request(url(path), { method: "HEAD" })]) {
      const response = await safeFetch(input, input instanceof Request ? undefined : { method: "HEAD" })
      expect(response.status).toBe(201)
      expect(response.headers.get("content-encoding")).toBe(path.slice(1))
      expect(response.url).toBe(url(path).href)
      expect(await response.clone().text()).toBe("")
      expect(await response.text()).toBe("")
    }
  })

  test.each(
    [204, 205, 304].flatMap((status) => ["gzip", "deflate", "br"].map((encoding) => [status, encoding] as const)),
  )("preserves empty status %i with %s metadata", async (status, encoding) => {
    const response = await safeFetch(url(`/empty/${status}/${encoding}`))
    expect(response.status).toBe(status)
    expect(response.headers.get("content-encoding")).toBe(encoding)
    expect(await response.clone().text()).toBe("")
    expect(await response.text()).toBe("")
  })

  test("uses the init method when overriding a Request method", async () => {
    const head = await safeFetch(new Request(url("/gzip")), { method: "HEAD" })
    expect(await head.text()).toBe("")
    const get = await safeFetch(new Request(url("/gzip"), { method: "HEAD" }), { method: "GET" })
    expect(await get.text()).toBe("decoded")
    await expect(safeFetch(new Request(url("/br"), { method: "HEAD" }), { method: "GET" })).rejects.toThrow(
      "CVE-2026-111497",
    )
  })

  test("preserves Request bodies and authentication without mutating caller headers", async () => {
    const request = new Request(url("/headers"), {
      method: "POST",
      headers: { authorization: "Bearer test", "accept-encoding": "br" },
      body: "request payload",
    })
    const response = await safeFetch(request)
    expect(await response.json()).toEqual({
      encoding: "gzip, deflate",
      auth: "Bearer test",
      method: "POST",
      body: "request payload",
    })
    expect(request.headers.get("accept-encoding")).toBe("br")
  })

  test("honors init header precedence", async () => {
    const response = await safeFetch(
      new Request(url("/headers"), {
        headers: { authorization: "old" },
      }),
      { headers: { authorization: "new", "accept-encoding": "br, zstd" } },
    )
    expect(await response.json()).toEqual({
      encoding: "gzip, deflate",
      auth: "new",
      method: "GET",
      body: "",
    })
  })

  test("returns identity responses without rewriting the body", async () => {
    expect(await (await safeFetch(url("/plain"))).text()).toBe("not a compressed stream")
  })

  test("supports explicitly raw responses without invoking a decoder", async () => {
    const response = await safeFetch(url("/br"), { decompress: false })
    expect(response.headers.get("content-encoding")).toBe("br")
    expect(await response.text()).toBe("not a compressed stream")
  })

  test("streams SSE without waiting for EOF", async () => {
    const response = await safeFetch(url("/stream"))
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: first\n\n")
    await reader.cancel()
  })

  test("preserves abort signals", async () => {
    await expect(safeFetch(url("/plain"), { signal: AbortSignal.abort() })).rejects.toThrow()
  })

  test("the real CLI entry rejects a provider's forced Brotli response", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "cz-http-provider-"))
    try {
      await Bun.write(
        path.join(home, ".clickzetta/llm.json"),
        JSON.stringify({
          provider: {
            cz: {
              npm: "@clickzetta/ai-gateway",
              options: { apiKey: "test-key", baseURL: url("/gateway/v1").href },
            },
          },
        }),
      )
      const child = Bun.spawn(
        [
          ...(process.env.CZ_CLI_BIN ? [process.env.CZ_CLI_BIN] : [process.execPath, "./src/main.ts"]),
          "agent",
          "llm",
          "test",
          "cz",
          "--format",
          "json",
        ],
        {
          cwd: path.resolve(import.meta.dir, ".."),
          env: { ...process.env, HOME: home, CLICKZETTA_TEST_HOME: home, CZ_CLI_DISABLE_UPDATE_CHECK: "1" },
          stdout: "pipe",
          stderr: "pipe",
          timeout: 15_000,
        },
      )
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(`${stdout}\n${stderr}`).toContain("CVE-2026-111497")
      expect(code).toBe(1)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  }, 30_000)

  test("installs the boundary in source and compiled processes and Workers", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cz-http-security-"))
    try {
      const security = JSON.stringify(path.resolve(import.meta.dir, "../src/bootstrap/http-security.ts"))
      await Bun.write(
        path.join(dir, "worker.ts"),
        `
        import ${security}
        try { await fetch(${JSON.stringify(url("/br").href)}); postMessage("unprotected") }
        catch (error) { postMessage(String(error)) }
      `,
      )
      await Bun.write(
        path.join(dir, "main.ts"),
        `
        import ${security}
        try { await fetch(${JSON.stringify(url("/br").href)}); throw new Error("unprotected") }
        catch (error) { if (!String(error).includes("CVE-2026-111497")) throw error }
        const worker = new Worker(new URL(import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js", import.meta.url))
        const message = await new Promise((resolve, reject) => {
          worker.onmessage = (event) => resolve(event.data)
          worker.onerror = reject
        })
        worker.terminate()
        if (!String(message).includes("CVE-2026-111497")) throw new Error(String(message))
        console.log("protected")
      `,
      )
      const binary = path.join(dir, process.platform === "win32" ? "security.exe" : "security")
      const result = await Bun.build({
        entrypoints: [path.join(dir, "main.ts"), path.join(dir, "worker.ts")],
        splitting: true,
        compile: { outfile: binary },
      })
      expect(result.success).toBe(true)
      for (const command of [[process.execPath, path.join(dir, "main.ts")], [binary]]) {
        const child = Bun.spawn(command, { cwd: dir, stdout: "pipe", stderr: "pipe" })
        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ])
        expect({ stdout: stdout.trim(), stderr, code }).toEqual({ stdout: "protected", stderr: "", code: 0 })
      }
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    }
  }, 30_000)
})
