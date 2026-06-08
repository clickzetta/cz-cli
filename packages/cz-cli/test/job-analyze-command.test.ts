import { describe, expect, mock, test } from "bun:test"

const calls: Array<Record<string, unknown>> = []
const actualJobPerformance = await import("../src/commands/job-performance.js")

mock.module("../src/commands/job-performance.js", () => ({
  ...actualJobPerformance,
  analyzeJobPerformance: async (options: Record<string, unknown>) => {
    calls.push(options)
    return "analysis text"
  },
}))

mock.module("../src/logger.js", () => ({
  logOperation: () => {},
}))

const { execute } = await import("../src/execute.ts")

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, unknown>
}

describe("job analyze", () => {
  test("runs the job performance analyzer from a local download path", async () => {
    const result = await execute("job analyze --path /tmp/job --analysis-mode detailed --enable-incremental-algorithm --no-enable-state-table")
    const json = firstJson(result.output)

    expect(result.exitCode).toBe(0)
    expect(calls).toEqual([
      {
        profile: undefined,
        workspaceName: undefined,
        jobId: undefined,
        path: "/tmp/job",
        analysisMode: "detailed",
        enableIncrementalAlgorithm: true,
        enableStateTable: false,
      },
    ])
    expect(json.data).toEqual({ output: "analysis text" })
  })

  test("runs the job performance analyzer for a job id", async () => {
    calls.length = 0
    const result = await execute("job analyze 202606081115127730367220 --workspace wanxin_test_04 --analysis-mode quick")

    expect(result.exitCode).toBe(0)
    expect(calls).toEqual([
      {
        profile: undefined,
        workspaceName: "wanxin_test_04",
        jobId: "202606081115127730367220",
        path: undefined,
        analysisMode: "quick",
        enableIncrementalAlgorithm: false,
        enableStateTable: true,
      },
    ])
  })
})
