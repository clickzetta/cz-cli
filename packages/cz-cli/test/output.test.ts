import { afterEach, describe, expect, test } from "bun:test"
import { error, successRows } from "../src/output/index.js"

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

  test("table errors render as plain text instead of JSON", () => {
    const output = captureOutput(() => {
      error("CZLH-42000", "schema not found", { format: "table" })
    })

    expect(output.stdout).toBe("ERROR CZLH-42000: schema not found\n")
    expect(output.stderr).toBe("")
    expect(process.exitCode).toBe(1)
  })

  test("csv, text, and jsonl errors also render as plain text", () => {
    expect(captureOutput(() => {
      error("X", "broken", { format: "csv" })
    }).stdout).toBe("ERROR X: broken\n")

    expect(captureOutput(() => {
      error("X", "broken", { format: "text" })
    }).stdout).toBe("ERROR X: broken\n")

    expect(captureOutput(() => {
      error("X", "broken", { format: "jsonl" })
    }).stdout).toBe("ERROR X: broken\n")
  })
})

describe("error output formatting", () => {
  test("json errors remain JSON", () => {
    const output = captureOutput(() => {
      error("CZLH-42000", "schema not found", { format: "json" })
    })

    expect(output.stdout).toBe('{"error":{"code":"CZLH-42000","message":"schema not found"}}\n')
  })

  test("pretty errors remain pretty JSON", () => {
    const output = captureOutput(() => {
      error("CZLH-42000", "schema not found", { format: "pretty" })
    })

    expect(output.stdout).toBe('{\n  "error": {\n    "code": "CZLH-42000",\n    "message": "schema not found"\n  }\n}\n')
  })
})
