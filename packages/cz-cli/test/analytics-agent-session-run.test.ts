import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { onStudio, stubStudioContext } from "./support/cz-fixtures.js"

// Network-boundary test: no mock.module of our own src. The real analytics-agent session run
// command runs (registerAnalyticsAgentCommand → resolveAnalyticsContext →
// getStudioContext → SDK), and only the network boundary (globalThis.fetch,
// intercepted in preload) is stubbed. The analysis-agent endpoint comes from a
// real profiles.toml and the studio auth/context plumbing from stubStudioContext().

const { createCli } = await import("../src/cli.ts")
const { registerAnalyticsAgentCommand } = await import("../src/commands/analytics-agent.ts")

const originalStdoutWrite = process.stdout.write.bind(process.stdout)
const originalStderrWrite = process.stderr.write.bind(process.stderr)

async function runAnalyticsCli(args: string[]): Promise<{ exitCode: number; output: string }> {
  const chunks: string[] = []
  const savedExitCode = process.exitCode

  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString())
    return true
  }) as typeof process.stdout.write

  process.stderr.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString())
    return true
  }) as typeof process.stderr.write

  process.exitCode = 0
  try {
    const cli = createCli(args)
    registerAnalyticsAgentCommand(cli)
    await cli.demandCommand(1, "").help().parseAsync()
  } catch {
    if (!process.exitCode) process.exitCode = 1
  } finally {
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
  }

  const exitCode = process.exitCode ?? 0
  process.exitCode = savedExitCode ?? 0
  return { exitCode, output: chunks.join("") }
}

describe("analytics-agent session run", () => {
  beforeEach(() => {
    process.exitCode = 0
    writeFileSync(
      join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
      [
        "[profiles.test]",
        "pat = 'pat'",
        "workspace = 'wanxin_test_04'",
        "instance = 'inst'",
        "service = 'uat-api.clickzetta.com'",
        "analysis_agent_endpoint = 'https://example.clickzetta.com'",
        "",
      ].join("\n"),
    )
    stubStudioContext()
  })

  afterEach(() => {
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    process.exitCode = 0
  })

  test("outputs the raw safe_question_poll payload by default", async () => {
    const pollPayload = {
      success: true,
      data: {
        questionId: 123,
        responses: [
          {
            resGroupId: 1,
            dataType: "thinking",
            modelRes: { data: { message: "step 1" } },
          },
          {
            resGroupId: 1,
            dataType: "summary",
            modelRes: { data: { message: "final answer" } },
          },
          {
            resGroupId: 1,
            dataType: "finish",
            modelRes: { data: { message: "done" } },
          },
        ],
      },
    }

    onStudio("/open/text2insight/query", () => ({ data: { questionId: 123 } }))
    onStudio("/open/safe_question_poll", () => pollPayload)

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "run",
      "--session-id",
      "7",
      "--msg",
      "hello",
    ])

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.output.trim())).toEqual(pollPayload)
  })

  test("shows the final-summary output when --summary is set", async () => {
    onStudio("/open/text2insight/query", () => ({ data: { questionId: 123 } }))
    onStudio("/open/safe_question_poll", () => ({
      success: true,
      data: {
        questionId: 123,
        responses: [
          {
            resGroupId: 1,
            dataType: "summary",
            modelRes: { data: { message: "final answer" } },
          },
          {
            resGroupId: 1,
            dataType: "finish",
            modelRes: { data: { message: "done" } },
          },
        ],
      },
    }))

    const result = await runAnalyticsCli([
      "analytics-agent",
      "session",
      "run",
      "--session-id",
      "7",
      "--msg",
      "hello",
      "--summary",
    ])

    expect(result.exitCode).toBe(0)
    expect(result.output.trim()).toBe("final answer")
  })
})
