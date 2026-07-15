// Ad-hoc stdio JSON-RPC smoke test for `cz-cli mcp serve`.
// Spawns the server, drives initialize -> tools/list, asserts stdout carries
// only well-formed JSON-RPC frames (no banner/log leakage), and that the two
// tools are advertised. Does NOT call tools/call (that needs a live LLM+profile).
import { spawn } from "node:child_process"

const BINARY = process.env.CZ_CLI_BIN ?? process.execPath
const BINARY_ENTRY = process.env.CZ_CLI_ENTRY ? [process.env.CZ_CLI_ENTRY] : ["./src/main.ts"]

const proc = spawn(BINARY, [...BINARY_ENTRY, "mcp", "serve"], {
  cwd: new URL("..", import.meta.url).pathname,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env },
})

let stdout = ""
let stderr = ""
proc.stdout.on("data", (d) => (stdout += d.toString()))
proc.stderr.on("data", (d) => (stderr += d.toString()))

function send(obj: unknown) {
  proc.stdin.write(JSON.stringify(obj) + "\n")
}

const results: string[] = []
function ok(name: string, cond: boolean, detail = "") {
  results.push(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`)
}

async function main() {
  // Give the in-process opencode server a moment to come up.
  await new Promise((r) => setTimeout(r, 3000))

  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } })
  await new Promise((r) => setTimeout(r, 1500))
  send({ jsonrpc: "2.0", method: "notifications/initialized" })
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
  await new Promise((r) => setTimeout(r, 1500))

  proc.stdin.end()
  proc.kill("SIGTERM")

  // Every non-empty stdout line must be a valid JSON-RPC frame.
  const lines = stdout.split("\n").filter((l) => l.trim() !== "")
  let allJson = true
  const parsed: any[] = []
  for (const line of lines) {
    try {
      const obj = JSON.parse(line)
      parsed.push(obj)
      if (obj.jsonrpc !== "2.0") allJson = false
    } catch {
      allJson = false
    }
  }
  ok("stdout is only JSON-RPC frames", allJson && lines.length > 0, `${lines.length} lines`)

  const initRes = parsed.find((p) => p.id === 1)
  ok("initialize responded", !!initRes?.result, initRes?.result?.serverInfo?.name ?? "")

  const toolsRes = parsed.find((p) => p.id === 2)
  const tools: any[] = toolsRes?.result?.tools ?? []
  const names = tools.map((t) => t.name).sort()
  ok("tools/list advertises cz + cz-reply", names.includes("cz") && names.includes("cz-reply"), names.join(","))

  console.log(results.join("\n"))
  if (stderr.trim()) console.log("--- stderr (informational) ---\n" + stderr.slice(0, 800))
  const failed = results.some((r) => r.startsWith("FAIL"))
  process.exit(failed ? 1 : 0)
}

main()
