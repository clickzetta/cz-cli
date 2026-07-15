import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { onFetch, stubStudioContext } from "./support/cz-fixtures.js"

// Network-boundary test: no mock.module of our own src or of @clickzetta/sdk. The real job
// profile command runs (execute → job profile → getStudioContext → SDK →
// fetch), and only the network boundary (globalThis.fetch, intercepted in
// preload) is stubbed. The studio auth/context plumbing (login, getCurrentUser,
// serviceInstanceList, listUserWorkspaces) is registered by stubStudioContext();
// the getJobProfile call is stubbed per-test with onFetch so each body varies.
//
// NOTE: the old test mocked getToken/getCurrentUser/getWorkspaceByName, so the
// only fetch calls it saw were serviceInstanceList + getJobProfile, and it
// asserted an EXACT request list. Running the real auth path now makes those
// calls hit the boundary too, so the exact-list assertions are replaced with
// assertions on the getJobProfile request specifically (its presence, brief
// query param, and pathname) — the actual intent of the original checks.

// Captures the getJobProfile requests so tests can assert on the URL/params.
const profileRequests: Array<{ url: string; method?: string; body?: unknown }> = []

function registerJobProfile(payload: unknown) {
  onFetch({
    match: (url) => url.includes("/api/v1/vcluster/job/getJobProfile"),
    respond: (url, method, body) => {
      profileRequests.push({ url, method, body })
      return payload
    },
  })
}

const { execute } = await import("../src/execute.ts")

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, unknown>
}

function prettyJson(output: string) {
  const lines = output.split("\n")
  return JSON.parse(lines.slice(lines.findIndex((line) => line === "{")).join("\n")) as Record<string, unknown>
}

beforeEach(() => {
  profileRequests.length = 0
  // A real profiles.toml satisfies the profile gate; the command still passes
  // every connection field explicitly on the CLI, which takes priority.
  writeFileSync(
    join(process.env.CLICKZETTA_TEST_HOME!, ".clickzetta", "profiles.toml"),
    [
      "[profiles.test]",
      "pat = 'token'",
      "workspace = 'wanxin_test_04'",
      "instance = 'jnsxwfyr'",
      "service = 'uat-api.clickzetta.com'",
      "",
    ].join("\n"),
  )
  stubStudioContext()
})

describe("job profile", () => {
  afterEach(() => {
    rmSync(join(tmpdir(), "cz-cli", "job-profile", "202606081115127730367220"), { recursive: true, force: true })
    rmSync(join(tmpdir(), "job-profile.raw.json"), { force: true })
  })

  test("returns only flattened profile rows", async () => {
    registerJobProfile({
      data: {
        jobDesc: {
          virtualCluster: "CXX_TEST_1",
          account: { userId: "13" },
          sqlJob: {
            query: ["refresh dynamic table order_summary;"],
            sqlConfig: {
              hint: {
                "cz.optimizer.incremental.enable": "true",
                "cz.sql.shuffle.partitions": "8",
              },
            },
          },
          queryTag: "daily_refresh",
        },
        jobStatus: {
          state: "SUCCEED",
          submitTime: "1780888512773",
          startTime: "1780888512775",
          endTime: "1780888513041",
          runningTime: "268",
          jobProfiling: {
            profiling: [
              { e: 100, t: "1780888512773" },
              { e: 108, t: "1780888512804" },
              { e: 110, t: "1780888512804" },
              { e: 111, t: "1780888512805" },
              { e: 120, t: "1780888513033" },
              { e: 130, t: "1780888513041" },
              { e: 140, t: "1780888513041" },
              { e: 150, t: "1780888513041" },
            ],
          },
        },
        jobSummary: {
          stats: {
            inputOutputStats: {
              inputRowCount: "0",
              inputBytes: "0",
              outputRowCount: "0",
              outputBytes: "0",
              inputCacheBytes: "0",
            },
          },
          meter: {
            measurements: [{ key: "cpu_wall_time", unit: "cru", value: "0.000000" }],
          },
        },
        ioRecords: [
          {
            tableName: "order_summary",
            type: "OUTPUT",
            recordCount: "0 行 / 0 Byte",
            cacheRead: "0 Byte",
          },
        ],
        jobMetaLite: {
          incrementalProperty: { isIncrementalPlan: "0.5", isDtOrMv: "DT" },
        },
      },
      respStatus: {},
    })

    const result = await execute(
      "job profile 202606081115127730367220 --workspace wanxin_test_04 --instance jnsxwfyr --pat token --service uat-api.clickzetta.com",
    )
    const json = firstJson(result.output)
    const data = json.data as Array<Record<string, string>>

    expect(result.exitCode).toBe(0)
    // The real auth path also calls login/getCurrentUser/serviceInstanceList/
    // listUserWorkspaces; assert on the profile request specifically.
    expect(profileRequests).toHaveLength(1)
    expect(new URL(profileRequests[0].url).pathname).toBe(
      "/clickzetta-lakeconsole/api/v1/vcluster/job/getJobProfile",
    )
    expect(new URL(profileRequests[0].url).searchParams.get("brief")).toBe("true")
    expect(data).toEqual([
      { key: "job_id", value: "202606081115127730367220" },
      { key: "workspace_name", value: "wanxin_test_04" },
      { key: "instance_id", value: "86" },
      { key: "status", value: "SUCCEED" },
      { key: "duration", value: "268ms" },
      {
        key: "duration_timeline",
        value: "{\"total\":\"268ms\",\"stages\":[{\"key\":\"setup\",\"label\":\"Initialization\",\"duration\":\"31ms\"},{\"key\":\"resuming_cluster\",\"label\":\"Cluster Starting\",\"duration\":\"1ms\"},{\"key\":\"queued\",\"label\":\"Waiting Execution\",\"duration\":\"228ms\"},{\"key\":\"running\",\"label\":\"Running\",\"duration\":\"8ms\"},{\"key\":\"finish\",\"label\":\"Completed\",\"duration\":\"0ms\"}]}",
      },
      { key: "start_time", value: "2026/06/08 11:15:12.773" },
      { key: "end_time", value: "2026/06/08 11:15:13.041" },
      { key: "cluster", value: "CXX_TEST_1" },
      { key: "owner", value: "UAT_TEST" },
      { key: "input_records", value: "0 rows / 0 Byte" },
      { key: "output_records", value: "0 rows / 0 Byte" },
      { key: "io_record_1_table_name", value: "order_summary" },
      { key: "io_record_1_type", value: "OUTPUT" },
      { key: "io_record_1_record_count", value: "0 rows / 0 Byte" },
      { key: "io_record_1_cache_read", value: "0 Byte" },
      { key: "cache_read", value: "0 Byte" },
      { key: "incremental_processing", value: "Yes" },
      { key: "small_file_merge", value: "No Merge" },
      { key: "cru_cost", value: "< 0.01 CRU*h" },
      { key: "task_instance", value: "" },
      { key: "materialized_view_acceleration", value: "" },
      { key: "query_tag", value: "daily_refresh" },
      { key: "sql_hints", value: "{\"cz.optimizer.incremental.enable\":\"true\",\"cz.sql.shuffle.partitions\":\"8\"}" },
      { key: "job_content", value: "refresh dynamic table order_summary;" },
    ])
  })

  test("returns truncated raw profile content without writing a file by default", async () => {
    registerJobProfile({
      data: {
        huge: "x".repeat(5000),
        jobDesc: {
          account: { userName: "UAT_TEST" },
          sqlJob: { sqlConfig: { hint: {} } },
        },
        jobStatus: { state: "SUCCEED" },
      },
      respStatus: {},
    })

    const result = await execute(
      "job profile 202606081115127730367220 --raw --workspace wanxin_test_04 --instance jnsxwfyr --pat token --service uat-api.clickzetta.com --format pretty",
    )
    const json = prettyJson(result.output)
    const data = json.data as Record<string, string | boolean | number>

    expect(result.exitCode).toBe(0)
    expect(profileRequests).toHaveLength(1)
    expect(new URL(profileRequests[0].url).pathname).toBe(
      "/clickzetta-lakeconsole/api/v1/vcluster/job/getJobProfile",
    )
    expect(json.ai_message).toBe(
      "Raw profile truncated to 4000 chars from 5268 chars. Use --no-limit to print the full payload, e.g. cz-cli job profile 202606081115127730367220 --raw --no-limit > job_profile.raw.json",
    )
    expect(data.truncated).toBe(true)
    expect(typeof data.raw).toBe("string")
    expect(String(data.raw)).toContain("...(truncated")
    expect(data.limit_chars).toBe(4000)
    expect(data.shown_chars).toBe(4026)
    expect(data.total_chars).toBe(5268)
    expect(data.path).toBeUndefined()
  })

  test("writes the full raw profile content only when --path is provided", async () => {
    registerJobProfile({
      data: {
        huge: "x".repeat(5000),
        jobDesc: {
          account: { userName: "UAT_TEST" },
          sqlJob: { sqlConfig: { hint: {} } },
        },
        jobStatus: { state: "SUCCEED" },
      },
      respStatus: {},
    })

    const path = join(tmpdir(), "job-profile.raw.json")
    const result = await execute(
      `job profile 202606081115127730367220 --raw --path ${path} --workspace wanxin_test_04 --instance jnsxwfyr --pat token --service uat-api.clickzetta.com --format pretty`,
    )
    const json = prettyJson(result.output)
    const data = json.data as Record<string, string | boolean | number>

    expect(result.exitCode).toBe(0)
    expect(data.path).toBe(path)
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, "utf-8")).toContain("\"huge\"")
  })

  test("surfaces api errors with debug logs", async () => {
    registerJobProfile({
      code: "200",
      success: true,
      data: {
        respStatus: {
          requestId: "request-1",
          errorCode: "CZLH-60005",
          errorMsg: "NotFound: ACTION: getModel, MODEL cz::meta::persistent::model::Job NotFound",
        },
      },
    })

    const result = await execute(
      "job profile 202606081115127730367220 --workspace wanxin_test_04 --instance jnsxwfyr --pat token --service uat-api.clickzetta.com --format pretty --debug",
    )

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain("\"code\": \"JOB_PROFILE_ERROR\"")
    expect(result.output).toContain("CZLH-60005")
    expect(result.output).toContain("[debug] job profile: context")
    expect(result.output).toContain("[debug] job profile: GET")
    expect(result.output).toContain("[debug] job profile: response")
    expect(result.output).toContain("[debug] job profile: api_error")
    expect(result.output).toContain("/clickzetta-lakeconsole/api/v1/vcluster/job/getJobProfile")
  })

  test("preserves base path in service URL (e.g. host/api)", async () => {
    // Regression: new URL(path, base) drops base's path when path starts with "/"
    registerJobProfile({
      data: {
        jobDesc: { account: { userName: "UAT_TEST" }, sqlJob: { sqlConfig: { hint: {} } } },
        jobStatus: { state: "SUCCEED" },
      },
      respStatus: {},
    })

    const result = await execute(
      "job profile 202606081115127730367220 --workspace wanxin_test_04 --instance jnsxwfyr --pat token --service czstudio.example.com/api",
    )
    expect(result.exitCode).toBe(0)
    const profileUrl = profileRequests.find((r) => r.url.includes("getJobProfile"))?.url
    expect(profileUrl).toBeDefined()
    expect(new URL(profileUrl!).pathname).toBe("/api/clickzetta-lakeconsole/api/v1/vcluster/job/getJobProfile")
  })
})
