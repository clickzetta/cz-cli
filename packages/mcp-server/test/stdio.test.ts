/**
 * stdio.test.ts — STDIO transport smoke test
 *
 * Spawns run-stdio.ts as a subprocess, sends an MCP initialize request,
 * and verifies the response contains result.capabilities.
 */

import { describe, it, expect } from "bun:test"
import { spawn } from "node:child_process"
import { resolve } from "node:path"

const SCRIPT = resolve(import.meta.dir, "../src/bin/run-stdio.ts")

const INITIALIZE_REQUEST = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  },
}) + "\n"

function runStdioHandshake(timeoutMs = 8000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", [SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, LOG_LEVEL: "silent" },
    })

    let stdout = ""
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
      reject(new Error(`STDIO handshake timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
      // Each MCP message is newline-delimited JSON
      const lines = stdout.split("\n")
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const msg = JSON.parse(trimmed) as Record<string, unknown>
          if (msg["id"] === 1) {
            clearTimeout(timer)
            child.kill()
            resolve(msg)
            return
          }
        } catch {
          // partial line — keep buffering
        }
      }
    })

    child.on("error", (err) => {
      if (!timedOut) {
        clearTimeout(timer)
        reject(err)
      }
    })

    child.on("close", (code) => {
      if (!timedOut) {
        clearTimeout(timer)
        // If we got a response already, resolve was already called
        if (stdout.trim()) {
          // Try to parse whatever we got
          const lines = stdout.split("\n").filter((l) => l.trim())
          for (const line of lines) {
            try {
              const msg = JSON.parse(line) as Record<string, unknown>
              if (msg["id"] === 1) {
                resolve(msg)
                return
              }
            } catch {
              // ignore
            }
          }
        }
        reject(new Error(`Process exited with code ${code} before sending response. stdout: ${stdout.slice(0, 200)}`))
      }
    })

    // Send the initialize request
    child.stdin.write(INITIALIZE_REQUEST)
  })
}

describe("STDIO transport smoke test", () => {
  it("responds to MCP initialize with result.capabilities", async () => {
    const response = await runStdioHandshake()

    expect(response).toBeDefined()
    expect(response["jsonrpc"]).toBe("2.0")
    expect(response["id"]).toBe(1)

    const result = response["result"] as Record<string, unknown> | undefined
    expect(result).toBeDefined()
    expect(result!["capabilities"]).toBeDefined()

    // serverInfo should be present
    const serverInfo = result!["serverInfo"] as Record<string, unknown> | undefined
    expect(serverInfo).toBeDefined()
    expect(typeof serverInfo!["name"]).toBe("string")
  }, 10000)
})
