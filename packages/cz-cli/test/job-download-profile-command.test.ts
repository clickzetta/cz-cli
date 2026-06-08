import { afterEach, describe, expect, mock, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const actualSdk = await import("@clickzetta/sdk")
const actualProfileStore = await import("../src/connection/profile-store.js")

const requests: Array<{ url: string; method?: string; headers?: Record<string, string>; body?: string }> = []

mock.module("@clickzetta/sdk", () => ({
  ...actualSdk,
  getToken: async () => ({ token: "token", instanceId: 86, userId: 7, expireTimeMs: 0, obtainedAt: Date.now() }),
  getCurrentUser: async () => ({ id: 7, name: "UAT_TEST", accountId: 100 }),
  getWorkspaceByName: async () => ({ workspaceId: 200, workspaceName: "wanxin_test_04", projectId: 300 }),
}))

mock.module("../src/connection/profile-store.js", () => ({
  ...actualProfileStore,
  getProfileConfig: () => undefined,
  patchProfileUserId: () => {},
}))

mock.module("../src/logger.js", () => ({
  logOperation: () => {},
}))

const { execute } = await import("../src/execute.ts")

globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const requestUrl = String(url)
  requests.push({
    url: requestUrl,
    method: init?.method,
    headers: init?.headers as Record<string, string> | undefined,
    body: init?.body as string | undefined,
  })
  if (requestUrl.includes("/clickzetta-portal/service/serviceInstanceList")) {
    return Response.json({ data: [{ id: 86, name: "jnsxwfyr", serviceId: 1 }] })
  }
  if (requestUrl.includes("/api/v1/vcluster/job/getJobPlan")) {
    return Response.json({ data: { jobPlan: { stages: [{ stageId: "stg0", operators: [{ operatorId: "Values1" }] }] } }, respStatus: {} })
  }
  if (requestUrl.includes("/api/v1/vcluster/job/getJobProgress")) {
    return Response.json({
      data: {
        progress: {
          stageProgress: {
            stg0: {
              state: "SUCCEEDED",
              startTime: "1780888512989",
              finishTime: "1780888513041",
              total: "1",
              succeed: "1",
            },
          },
        },
      },
      respStatus: {},
    })
  }
  if (requestUrl.includes("/api/v1/vcluster/job/getJobProfile")) {
    return Response.json({
      data: {
        jobDesc: {
          virtualCluster: "CXX_TEST_1",
          account: { userId: "13", userName: "UAT_TEST" },
          sqlJob: { query: ["refresh dynamic table order_summary;"] },
          queryTag: "",
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
              { e: 110, t: "1780888512804" },
              { e: 111, t: "1780888512805" },
              { e: 120, t: "1780888513033" },
              { e: 130, t: "1780888513041" },
              { e: 160, t: "1780888513041" },
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
          stageSummary: {
            stg0: {
              stageId: "stg0",
              startTime: "1780888513034",
              endTime: "1780888513040",
              inputOutputStats: {
                inputRowCount: "0",
                inputBytes: "0",
                outputRowCount: "0",
                outputBytes: "0",
              },
              operatorSummary: {
                Values1: { opId: "Values1", wallTimeNs: { sum: "2062" }, rowCount: { sum: "0" } },
              },
              taskCount: "1",
            },
          },
          meter: {
            measurements: [{ key: "cpu_wall_time", unit: "cru", value: "0.000000" }],
          },
        },
        jobMetaLite: {
          incrementalProperty: { isIncrementalPlan: "0.5", isDtOrMv: "DT" },
          isHitResultCache: false,
        },
      },
      respStatus: {},
    })
  }
  return Response.json({ respStatus: { errorCode: "UNKNOWN", errorMsg: `Unhandled ${requestUrl}` } })
}) as typeof fetch

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, unknown>
}

function prettyJson(output: string) {
  const lines = output.split("\n")
  return JSON.parse(lines.slice(lines.findIndex((line) => line === "{")).join("\n")) as Record<string, Record<string, unknown>>
}

describe("job profile", () => {
  afterEach(() => {
    requests.length = 0
  })

  test("downloads job plan and profile files and returns only paths", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cz-job-profile-"))
    try {
      writeFileSync(join(dir, "job_plan.json"), JSON.stringify({ data: { respStatus: { errorCode: "STALE" } } }))
      writeFileSync(join(dir, "job_progress.json"), JSON.stringify({ stale: true }))
      const result = await execute(
        `job profile download 202606081115127730367220 --path ${dir} --workspace wanxin_test_04 --instance jnsxwfyr --pat token --service uat-api.clickzetta.com`,
      )
      const json = firstJson(result.output)
      const data = json.data as Record<string, unknown>
      const files = data.files as Array<Record<string, unknown>>

      expect(result.exitCode).toBe(0)
      expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
        "/clickzetta-portal/service/serviceInstanceList",
        "/clickzetta-lakeconsole/api/v1/vcluster/job/getJobPlan",
        "/clickzetta-lakeconsole/api/v1/vcluster/job/getJobProfile",
      ])
      expect(requests[1].headers).toMatchObject({
        "X-Clickzetta-Token": "token",
        instanceId: "86",
        workspaceName: "wanxin_test_04",
      })
      expect(data).not.toHaveProperty("download_dir")
      expect(data.job_id).toBe("202606081115127730367220")
      expect(data.workspace_name).toBe("wanxin_test_04")
      expect(data.instance_id).toBe(86)
      expect(data).not.toHaveProperty("tabs")
      expect(data).toHaveProperty("path", dir)
      expect(new URL(requests[2].url).searchParams.get("brief")).toBe("true")
      expect(files.map((file) => file.type)).toEqual(["job_plan", "job_profile"])
      expect(files.every((file) => typeof file.path === "string" && existsSync(file.path))).toBe(true)
      expect(readFileSync(join(dir, "job_plan.json"), "utf-8")).toContain("\"jobPlan\"")
      expect(readFileSync(join(dir, "job_profile.json"), "utf-8")).toContain("\"jobDesc\"")
      expect(existsSync(join(dir, "job_progress.json"))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("returns page-aligned detail tabs without writing downloaded files", async () => {
    const result = await execute(
      "job profile detail 202606081115127730367220 --workspace wanxin_test_04 --instance jnsxwfyr --pat token --service uat-api.clickzetta.com",
    )
    const json = firstJson(result.output)
    const data = json.data as Record<string, unknown>
    const tabs = data.tabs as Record<string, Record<string, unknown>>

    expect(result.exitCode).toBe(0)
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/clickzetta-portal/service/serviceInstanceList",
      "/clickzetta-lakeconsole/api/v1/vcluster/job/getJobPlan",
      "/clickzetta-lakeconsole/api/v1/vcluster/job/getJobProgress",
      "/clickzetta-lakeconsole/api/v1/vcluster/job/getJobProfile",
    ])
    expect(new URL(requests[3].url).searchParams.get("brief")).toBe("true")
    expect(data).not.toHaveProperty("files")
    expect(data).not.toHaveProperty("path")
    expect(data.job_id).toBe("202606081115127730367220")
    expect(data.workspace_name).toBe("wanxin_test_04")
    expect(data.instance_id).toBe(86)
      expect(tabs.detail.basic_info as Array<Record<string, unknown>>).toEqual([
        {
          key: "duration",
          label: "Duration",
          value: "268ms",
          raw_value: "268ms",
          help: null,
          breakdown: [
            { key: "initialization", label: "Initialization", value: "31ms", raw_value: "31ms" },
            { key: "cluster_starting", label: "Cluster Starting", value: "1ms", raw_value: "1ms" },
            { key: "waiting_execution", label: "Waiting Execution", value: "228ms", raw_value: "228ms" },
            { key: "executing", label: "Executing", value: "8ms", raw_value: "8ms" },
            { key: "finished", label: "Finished", value: "0ms", raw_value: "0ms" },
          ],
        },
        { key: "start_time", label: "Start Time", value: "2026/06/08 11:15:12.775", raw_value: "2026/06/08 11:15:12.775", help: null },
        { key: "end_time", label: "End Time", value: "2026/06/08 11:15:13.041", raw_value: "2026/06/08 11:15:13.041", help: null },
        { key: "cluster", label: "Cluster", value: "CXX_TEST_1", raw_value: "CXX_TEST_1", help: null },
        { key: "owner", label: "Owner", value: "UAT_TEST", raw_value: "UAT_TEST", help: null },
        { key: "input_records", label: "Input Records", value: "0行 / 0 Byte", raw_value: "0行 / 0 Byte", help: null },
        { key: "output_records", label: "Output Records", value: "0行 / 0 Byte", raw_value: "0行 / 0 Byte", help: null },
        { key: "cache_read", label: "Cache Read", value: "0 Byte", raw_value: "0 Byte", help: null },
        { key: "incremental_processing", label: "Incremental Processing", value: "是", raw_value: "是", help: null },
        { key: "small_file_merge", label: "Small File Merge", value: "无合并", raw_value: "无合并", help: null },
        { key: "cru_cost", label: "CRU Cost", value: "小于 0.01 CRU*时", raw_value: "小于 0.01 CRU*时", help: null },
        { key: "task_instance", label: "Task Instance", value: "", raw_value: null, help: null },
        { key: "materialized_view_acceleration", label: "Materialized View Acceleration", value: "", raw_value: null, help: null },
        { key: "query_tag", label: "queryTag", value: "", raw_value: "", help: null },
      ])
      expect((tabs.stage_diagnosis.stage_execution as Record<string, unknown>).rows).toEqual([
        {
          locate_dag: true,
          stage_name: "stg0",
          start_time: "1780888513034",
          timeline: null,
          duration: "6ms",
          task_count: "1",
          operator_count: 1,
          status: "SUCCEEDED",
          end_time: "1780888513040",
          input_records: "0 行 / 0 Byte",
          output_records: "0 行 / 0 Byte",
        },
      ])
      expect((tabs.operator_diagnosis.operator_execution as Record<string, unknown>).rows).toEqual([
        { locate_dag: true, operator_name: "Values1", stage_name: "stg0", duration: "0ms", more_fields: "" },
      ])
  })

  test("fails instead of writing API error payloads as profile files", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url)
      requests.push({ url: requestUrl, method: init?.method })
      if (requestUrl.includes("/clickzetta-portal/service/serviceInstanceList")) {
        return Response.json({ data: [{ id: 86, name: "jnsxwfyr", serviceId: 1 }] })
      }
      return Response.json({
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
    }) as typeof fetch

    try {
      const result = await execute(
        "job profile download 202606081115127730367220 --workspace wanxin_test_04 --instance jnsxwfyr --pat token --service uat-api.clickzetta.com --format pretty --debug",
      )

      expect(result.exitCode).toBe(1)
      expect(result.output).toContain("\"code\": \"JOB_PROFILE_DOWNLOAD_ERROR\"")
      expect(result.output).toContain("CZLH-60005")
      expect(result.output).toContain("[debug] job profile: context")
      expect(result.output).toContain("[debug] job profile: GET")
      expect(result.output).toContain("[debug] job profile: response")
      expect(result.output).toContain("[debug] job profile: api_error")
      expect(result.output).toContain("/clickzetta-lakeconsole/api/v1/vcluster/job/getJobPlan")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("does not leave partial files when profile download fails after plan succeeds", async () => {
    const originalFetch = globalThis.fetch
    const dir = mkdtempSync(join(tmpdir(), "cz-job-profile-"))
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url)
      requests.push({ url: requestUrl, method: init?.method })
      if (requestUrl.includes("/clickzetta-portal/service/serviceInstanceList")) {
        return Response.json({ data: [{ id: 86, name: "jnsxwfyr", serviceId: 1 }] })
      }
      if (requestUrl.includes("/api/v1/vcluster/job/getJobPlan")) {
        return Response.json({ data: { jobPlan: { stages: [] } }, respStatus: {} })
      }
      return Response.json({
        code: "200",
        success: true,
        data: {
          respStatus: {
            requestId: "request-2",
            errorCode: "CZLH-60006",
            errorMsg: "profile failed",
          },
        },
      })
    }) as typeof fetch

    try {
      const result = await execute(
        `job profile download 202606081115127730367220 --path ${dir} --workspace wanxin_test_04 --instance jnsxwfyr --pat token --service uat-api.clickzetta.com --format pretty --debug`,
      )

      expect(result.exitCode).toBe(1)
      expect(result.output).toContain("CZLH-60006")
      expect(existsSync(join(dir, "job_plan.json"))).toBe(false)
      expect(existsSync(join(dir, "job_profile.json"))).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
