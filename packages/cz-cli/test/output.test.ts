import { afterEach, describe, expect, test } from "bun:test"
import { successRows } from "../src/output/index.js"

const originalStdoutWrite = process.stdout.write.bind(process.stdout)
const originalStderrWrite = process.stderr.write.bind(process.stderr)

afterEach(() => {
  process.stdout.write = originalStdoutWrite as typeof process.stdout.write
  process.stderr.write = originalStderrWrite as typeof process.stderr.write
  process.exitCode = 0
})

function captureOutput(run: () => void) {
  let stdout = ""
  let stderr = ""
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString()
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString()
    return true
  }) as typeof process.stderr.write
  run()
  return { stdout, stderr }
}

describe("row output formatting", () => {
  test("jsonl emits self-describing objects", () => {
    const output = captureOutput(() => {
      successRows(["schema_name", "table_name"], [["public", "demo"]], { format: "jsonl" })
    })

    expect(output.stdout).toBe('{"schema_name":"public","table_name":"demo"}\n')
    expect(output.stderr).toBe("")
  })

  test("row-only formats send ai_message to stderr", () => {
    const output = captureOutput(() => {
      successRows(["schema_name"], [["public"]], {
        format: "jsonl",
        aiMessage: "Results truncated to 100 rows (more available).",
      })
    })

    expect(output.stdout).toBe('{"schema_name":"public"}\n')
    expect(output.stderr).toBe("Results truncated to 100 rows (more available).\n")
  })
})
