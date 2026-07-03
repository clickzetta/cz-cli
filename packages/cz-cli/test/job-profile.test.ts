import { describe, expect, test } from "bun:test"
import { buildJobProfileRows } from "../src/commands/job-profile"

describe("buildJobProfileRows", () => {
  test("flattens brief job profile data into key/value rows", () => {
    const rows = buildJobProfileRows({
      jobId: "202606081949122951304081",
      workspaceName: "wanxin_test_04",
      instanceId: 86,
      currentUserName: "UAT_TEST",
      jobProfile: {
        data: {
          jobDesc: {
            virtualCluster: "CXX_TEST_1",
            account: { userId: "13" },
            queryTag: "daily_refresh",
            sqlJob: {
              query: ["refresh dynamic table order_summary;"],
              sqlConfig: {
                hint: {
                  "cz.optimizer.incremental.enable": "true",
                  "cz.sql.shuffle.partitions": "8",
                },
              },
            },
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
            incrementalProperty: {
              isIncrementalPlan: "0.5",
              isDtOrMv: "DT",
            },
            isMvUsed: true,
            isAutomvUsed: false,
          },
          externalScheduledInfo: "{\"scheduleInstanceId\":\"task-inst-001\"}",
        },
      },
    })

    expect(rows).toEqual([
      { key: "job_id", value: "202606081949122951304081" },
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
      { key: "task_instance", value: "task-inst-001" },
      { key: "materialized_view_acceleration", value: "USERMV" },
      { key: "query_tag", value: "daily_refresh" },
      {
        key: "sql_hints",
        value: "{\"cz.optimizer.incremental.enable\":\"true\",\"cz.sql.shuffle.partitions\":\"8\"}",
      },
      { key: "job_content", value: "refresh dynamic table order_summary;" },
    ])
  })

  test("uses empty strings for missing optional values", () => {
    const rows = buildJobProfileRows({
      jobId: "1",
      workspaceName: "ws",
      instanceId: 2,
      currentUserName: "fallback_user",
      jobProfile: {
        data: {
          jobDesc: {
            account: { userId: "13" },
            sqlJob: {},
          },
          jobStatus: {
            state: "RUNNING",
          },
          jobSummary: {},
          jobMetaLite: {},
        },
      },
    })

    expect(rows.find((row) => row.key === "owner")).toEqual({ key: "owner", value: "fallback_user" })
    expect(rows.find((row) => row.key === "query_tag")).toEqual({ key: "query_tag", value: "" })
    expect(rows.find((row) => row.key === "sql_hints")).toEqual({ key: "sql_hints", value: "" })
    expect(rows.find((row) => row.key === "small_file_merge")).toEqual({ key: "small_file_merge", value: "No Merge" })
    expect(rows.find((row) => row.key === "duration_timeline")).toEqual({ key: "duration_timeline", value: "" })
    expect(rows.find((row) => row.key === "io_record_1_table_name")).toBeUndefined()
    expect(rows.find((row) => row.key === "job_content")).toEqual({ key: "job_content", value: "" })
  })

  test("does not synthesize io record rows when profile does not include them", () => {
    const rows = buildJobProfileRows({
      jobId: "2",
      workspaceName: "ws",
      instanceId: 86,
      currentUserName: "UAT_TEST",
      jobProfile: {
        data: {
          jobDesc: {
            account: { userId: "13" },
            sqlJob: {},
          },
          jobStatus: {
            state: "SUCCEED",
          },
          jobSummary: {
            stats: {
              inputOutputStats: {
                inputRowCount: "0",
                inputBytes: "0",
                outputRowCount: "1",
                outputBytes: "368",
                inputCacheBytes: "0",
              },
            },
          },
        },
      },
    })

    expect(rows.find((row) => row.key === "io_record_1_table_name")).toBeUndefined()
    expect(rows.find((row) => row.key === "io_record_1_type")).toBeUndefined()
    expect(rows.find((row) => row.key === "io_record_1_record_count")).toBeUndefined()
    expect(rows.find((row) => row.key === "io_record_1_cache_read")).toBeUndefined()
  })

  test("uses page defaults for ended jobs without incremental or compaction flags", () => {
    const rows = buildJobProfileRows({
      jobId: "3",
      workspaceName: "ws",
      instanceId: 86,
      currentUserName: "UAT_TEST",
      jobProfile: {
        data: {
          jobDesc: {
            sqlJob: {},
          },
          jobStatus: {
            state: "SUCCEED",
            jobProfiling: {
              profiling: [
                { e: 100, t: "1780989841749" },
                { e: 150, t: "1780989880427" },
              ],
            },
          },
          jobSummary: {},
          jobMetaLite: {},
        },
      },
    })

    expect(rows.find((row) => row.key === "incremental_processing")).toEqual({
      key: "incremental_processing",
      value: "No",
    })
    expect(rows.find((row) => row.key === "small_file_merge")).toEqual({
      key: "small_file_merge",
      value: "No Merge",
    })
  })

  test("uses submitTime and endTime for duration instead of runningTime", () => {
    const rows = buildJobProfileRows({
      jobId: "4",
      workspaceName: "ws",
      instanceId: 86,
      currentUserName: "UAT_TEST",
      jobProfile: {
        data: {
          jobDesc: {
            sqlJob: {},
          },
          currentMs: "1780888513041",
          jobStatus: {
            state: "SUCCEED",
            submitTime: "1780888512773",
            startTime: "1780888512775",
            endTime: "1780888513041",
            runningTime: "999",
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
          jobSummary: {},
          jobMetaLite: {},
        },
      },
    })

    expect(rows.find((row) => row.key === "duration")).toEqual({
      key: "duration",
      value: "268ms",
    })
    expect(rows.find((row) => row.key === "duration_timeline")).toEqual({
      key: "duration_timeline",
      value: "{\"total\":\"268ms\",\"stages\":[{\"key\":\"setup\",\"label\":\"Initialization\",\"duration\":\"31ms\"},{\"key\":\"resuming_cluster\",\"label\":\"Cluster Starting\",\"duration\":\"1ms\"},{\"key\":\"queued\",\"label\":\"Waiting Execution\",\"duration\":\"228ms\"},{\"key\":\"running\",\"label\":\"Running\",\"duration\":\"8ms\"},{\"key\":\"finish\",\"label\":\"Completed\",\"duration\":\"0ms\"}]}",
    })
  })

  test("falls back to runningTime when submitTime or startTime is invalid", () => {
    const rows = buildJobProfileRows({
      jobId: "5",
      workspaceName: "ws",
      instanceId: 86,
      currentUserName: "UAT_TEST",
      jobProfile: {
        data: {
          jobDesc: {
            sqlJob: {},
          },
          currentMs: "1780888513041",
          jobStatus: {
            state: "SUCCEED",
            submitTime: "0",
            startTime: "0",
            endTime: "1780888513041",
            runningTime: "268",
            jobProfiling: {
              profiling: [
                { e: 100, t: "1780888512773" },
                { e: 150, t: "1780888513041" },
              ],
            },
          },
          jobSummary: {},
          jobMetaLite: {},
        },
      },
    })

    expect(rows.find((row) => row.key === "duration")).toEqual({
      key: "duration",
      value: "268ms",
    })
    expect(rows.find((row) => row.key === "duration_timeline")).toEqual({
      key: "duration_timeline",
      value: "",
    })
  })

  test("uses stageDuration values with enum-like stage ids", () => {
    const rows = buildJobProfileRows({
      jobId: "6",
      workspaceName: "ws",
      instanceId: 86,
      currentUserName: "UAT_TEST",
      jobProfile: {
        data: {
          jobDesc: {
            sqlJob: {},
          },
          currentMs: "1780888513041",
          jobStatus: {
            state: "SUCCEED",
            submitTime: "1780888512773",
            startTime: "1780888512775",
            endTime: "1780888513041",
            runningTime: "268",
            jobProfiling: {
              stageDuration: [
                { n: 0, ms: "31" },
                { n: 1, ms: "1" },
                { n: 2, ms: "228" },
                { n: 3, ms: "8" },
                { n: 5, ms: "0" },
              ],
            },
          },
          jobSummary: {},
          jobMetaLite: {},
        },
      },
    })

    expect(rows.find((row) => row.key === "duration_timeline")).toEqual({
      key: "duration_timeline",
      value: "{\"total\":\"268ms\",\"stages\":[{\"key\":\"setup\",\"label\":\"Initialization\",\"duration\":\"31ms\"},{\"key\":\"resuming_cluster\",\"label\":\"Cluster Starting\",\"duration\":\"1ms\"},{\"key\":\"queued\",\"label\":\"Waiting Execution\",\"duration\":\"228ms\"},{\"key\":\"running\",\"label\":\"Running\",\"duration\":\"8ms\"},{\"key\":\"finish\",\"label\":\"Completed\",\"duration\":\"0ms\"}]}",
    })
  })
})
