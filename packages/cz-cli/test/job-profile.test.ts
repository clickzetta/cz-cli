import { describe, expect, test } from "bun:test"
import { buildJobProfilePayload } from "../src/commands/job-profile"

const profile = {
  data: {
    status: "执行成功",
    duration: "268ms",
    startTime: "2026/06/08 11:15:12.773",
    endTime: "2026/06/08 11:15:13.041",
    vcName: "CXX_TEST_1",
    owner: "UAT_TEST",
    inputRecord: "0行 / 0 Byte",
    outputRecord: "0行 / 0 Byte",
    cacheBytes: "0 Byte",
    incremental: true,
    smallFileMerge: "无合并",
    cruCost: "小于 0.01 CRU*时",
    taskInstance: "--",
    materializedViewAcceleration: "--",
    queryTag: "--",
    sql: "refresh dynamic table order_summary;",
    ioRecords: [],
    stages: [
      {
        stageName: "stage0",
        startTime: "2026/06/08 11:15:13.034",
        timeline: "",
        duration: "6ms",
        task: 1,
        operator: 2,
        status: "执行成功",
        endTime: "2026/06/08 11:15:13.040",
        inputRecord: "0 行/0 Byte",
        outputRecord: "0 行/0 Byte",
      },
    ],
    stageConcurrency: [
      {
        stageName: "stg0",
        startTime: "2026-06-08 11:15:13.034",
        endTime: "2026-06-08 11:15:13.040",
        duration: "6ms",
        points: [{ time: "2026-06-08 11:15:13.034", concurrency: 1 }],
      },
    ],
    stageDag: [{ name: "stg0", status: "执行成功", duration: "6ms", task: 1, operator: 2 }],
    operators: [
      { operatorName: "Values1", stageName: "stg0", duration: "0ms", moreFields: null },
      { operatorName: "TableSink0", stageName: "stg0", duration: "0ms", moreFields: { rows: 0 } },
    ],
    operatorDag: [
      { stageName: "stg0", operatorName: "Values1", duration: "0ms" },
      { stageName: "stg0", operatorName: "TableSink0", duration: "0ms" },
    ],
  },
}

describe("buildJobProfilePayload", () => {
  test("builds a page-aligned tabs payload for downloaded job profile files", () => {
    const payload = buildJobProfilePayload({
      jobId: "202606081115127730367220",
      workspaceName: "wanxin_test_04",
      instanceId: 86,
      jobProfile: profile,
      files: [
        { type: "job_plan", path: "/tmp/job_plan.json", exists: true, bytes: 10, source: "/lh/getJob" },
        { type: "job_profile", path: "/tmp/job_profile.json", exists: true, bytes: 20, source: "/lh/getJob" },
      ],
    })

    expect(payload).toMatchObject({
      job_id: "202606081115127730367220",
      workspace_name: "wanxin_test_04",
      instance_id: 86,
      status: "执行成功",
      files: [
        { type: "job_plan", path: "/tmp/job_plan.json", exists: true, bytes: 10 },
        { type: "job_profile", path: "/tmp/job_profile.json", exists: true, bytes: 20 },
      ],
    })
    expect(payload).not.toHaveProperty("download_dir")

    expect(payload.tabs.detail.basic_info.map((item) => item.label)).toEqual([
      "Duration",
      "Start Time",
      "End Time",
      "Cluster",
      "Owner",
      "Input Records",
      "Output Records",
      "Cache Read",
      "Incremental Processing",
      "Small File Merge",
      "CRU Cost",
      "Task Instance",
      "Materialized View Acceleration",
      "queryTag",
    ])
    expect(payload.tabs.detail.job_content).toEqual({
      sql: "refresh dynamic table order_summary;",
      lines: [{ line: 1, text: "refresh dynamic table order_summary;" }],
      copyable: true,
    })
    expect(payload.tabs.detail.io_records).toEqual({
      rows: [],
    })

    expect(payload.tabs.stage_diagnosis.stage_execution.columns.map((column) => column.label)).toEqual([
      "Locate DAG",
      "Stage Name",
      "Start Time",
      "Timeline",
      "Duration",
      "Task",
      "Operator",
      "Status",
      "End Time",
      "Input Records",
      "Output Records",
    ])
    expect(payload.tabs.stage_diagnosis.stage_execution.rows[0]).toMatchObject({
      stage_name: "stage0",
      duration: "6ms",
      task_count: 1,
      operator_count: 2,
    })
    expect(payload.tabs.stage_diagnosis.duration_concurrency.rows[0]).toMatchObject({
      stage_name: "stg0",
      duration: "6ms",
    })
    expect(payload.tabs.stage_diagnosis.dag.nodes).toEqual([
      { name: "stg0", status: "执行成功", duration: "6ms", task_count: 1, operator_count: 2 },
    ])

    expect(payload.tabs.operator_diagnosis.operator_execution.columns.map((column) => column.label)).toEqual([
      "Locate DAG",
      "Operator Name",
      "Stage",
      "Duration",
      "More Fields",
    ])
    expect(payload.tabs.operator_diagnosis.operator_execution.rows).toEqual([
      { locate_dag: true, operator_name: "Values1", stage_name: "stg0", duration: "0ms", more_fields: null },
      { locate_dag: true, operator_name: "TableSink0", stage_name: "stg0", duration: "0ms", more_fields: { rows: 0 } },
    ])
    expect(payload.tabs.operator_diagnosis.dag.nodes).toEqual([
      { stage_name: "stg0", operator_name: "Values1", duration: "0ms" },
      { stage_name: "stg0", operator_name: "TableSink0", duration: "0ms" },
    ])
  })

  test("normalizes Studio jobPlan and jobProfile API response shapes", () => {
    const payload = buildJobProfilePayload({
      jobId: "202606081115127730367220",
      workspaceName: "wanxin_test_04",
      instanceId: 86,
      jobPlan: {
        data: {
          jobPlan: {
            stages: [
              {
                stageId: "stg0",
                stageName: "stage0",
                operators: [
                  { id: "Values1", operatorName: "Values1" },
                  { id: "TableSink0", operatorName: "TableSink0" },
                ],
              },
            ],
          },
        },
      },
      jobProfile: {
        data: {
          jobStatus: { state: "SUCCEEDED" },
          jobSummary: {
            duration: "268ms",
            startTime: "2026/06/08 11:15:12.773",
            endTime: "2026/06/08 11:15:13.041",
            stageSummary: {
              stg0: {
                state: "SUCCEEDED",
                startTime: "2026/06/08 11:15:13.034",
                endTime: "2026/06/08 11:15:13.040",
                duration: "6ms",
                inputRecord: "0 行/0 Byte",
                outputRecord: "0 行/0 Byte",
                operatorSummary: {
                  Values1: { wallTimeNs: { sum: "0" } },
                  TableSink0: { wallTimeNs: { sum: "0" }, tableSinkSummary: { compressedOutputBytes: { sum: "0" } } },
                },
              },
            },
          },
          jobContent: "refresh dynamic table order_summary;",
        },
      },
      files: [
        { type: "job_plan", path: "/tmp/job_plan.json", exists: true, bytes: 10 },
        { type: "job_profile", path: "/tmp/job_profile.json", exists: true, bytes: 20 },
      ],
    })

    expect(payload.status).toBe("SUCCEEDED")
    expect(payload.tabs.detail.basic_info[0]).toMatchObject({ label: "Duration", value: "268ms" })
    expect(payload.tabs.detail.job_content.lines).toEqual([{ line: 1, text: "refresh dynamic table order_summary;" }])
    expect(payload.tabs.stage_diagnosis.stage_execution.rows).toEqual([
      {
        locate_dag: true,
        stage_name: "stage0",
        start_time: "2026/06/08 11:15:13.034",
        timeline: null,
        duration: "6ms",
        task_count: null,
        operator_count: 2,
        status: "SUCCEEDED",
        end_time: "2026/06/08 11:15:13.040",
        input_records: "0 行/0 Byte",
        output_records: "0 行/0 Byte",
      },
    ])
    expect(payload.tabs.stage_diagnosis.dag.nodes).toEqual([
      { name: "stage0", status: "SUCCEEDED", duration: "6ms", task_count: null, operator_count: 2 },
    ])
    expect(payload.tabs.operator_diagnosis.operator_execution.rows).toEqual([
      { locate_dag: true, operator_name: "Values1", stage_name: "stage0", duration: "0ms", more_fields: "" },
      {
        locate_dag: true,
        operator_name: "TableSink0",
        stage_name: "stage0",
        duration: "0ms",
        more_fields: { tableSinkSummary: { compressedOutputBytes: { sum: "0" } } },
      },
    ])
  })

  test("normalizes Job Profile page brief profile, progress, and plan responses", () => {
    const payload = buildJobProfilePayload({
      jobId: "202606081115127730367220",
      workspaceName: "wanxin_test_04",
      instanceId: 86,
      jobPlan: {
        data: {
          jobPlan: {
            stages: [
              {
                stageId: "stg0",
                operators: [
                  { operatorId: "Values1", parentOperatorId: [], operatorAttribute: { fields: "f53" } },
                  { operatorId: "TableSink0", parentOperatorId: ["Values1"], operatorAttribute: { output_table: "", fields: "f53" } },
                ],
                dop: "1",
              },
            ],
            inputTables: [],
            outputTables: [""],
          },
        },
      },
      jobProgress: {
        data: {
          progress: {
            stageProgress: {
              stg0: {
                succeed: "1",
                total: "1",
                startTime: "1780888512989",
                finishTime: "1780888513041",
                state: "SUCCEEDED",
              },
            },
          },
        },
      },
      jobProfile: {
        data: {
          jobDesc: {
            virtualCluster: "CXX_TEST_1",
            account: { userId: "13", userName: "UAT_TEST" },
            sqlJob: {
              query: ["refresh dynamic table order_summary;"],
            },
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
                  TableSink0: {
                    opId: "TableSink0",
                    inputOutputStats: { outputRowCount: "0" },
                    wallTimeNs: { sum: "3940" },
                    rowCount: { sum: "0" },
                  },
                },
                taskCount: "1",
              },
            },
            meter: {
              measurements: [{ key: "cpu_wall_time", unit: "cru", value: "0.000000" }],
            },
          },
          jobMetaLite: {
            incrementalProperty: {
              isIncrementalPlan: "0.5",
              isDtOrMv: "DT",
            },
            isHitResultCache: false,
          },
        },
      },
      files: [
        { type: "job_plan", path: "/tmp/job_plan.json", exists: true, bytes: 10 },
        { type: "job_progress", path: "/tmp/job_progress.json", exists: true, bytes: 11 },
        { type: "job_profile", path: "/tmp/job_profile.json", exists: true, bytes: 20 },
      ],
    })

    expect(payload.status).toBe("SUCCEED")
    expect(payload.files.map((file) => file.type)).toEqual(["job_plan", "job_progress", "job_profile"])
    expect(payload.tabs.detail.basic_info).toEqual([
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
    expect(payload.tabs.detail.job_content.lines).toEqual([{ line: 1, text: "refresh dynamic table order_summary;" }])
    expect(payload.tabs.stage_diagnosis.stage_execution.rows).toEqual([
      {
        locate_dag: true,
        stage_name: "stg0",
        start_time: "1780888513034",
        timeline: null,
        duration: "6ms",
        task_count: "1",
        operator_count: 2,
        status: "SUCCEEDED",
        end_time: "1780888513040",
        input_records: "0 行 / 0 Byte",
        output_records: "0 行 / 0 Byte",
      },
    ])
    expect(payload.tabs.operator_diagnosis.operator_execution.rows).toEqual([
      { locate_dag: true, operator_name: "Values1", stage_name: "stg0", duration: "0ms", more_fields: "" },
      {
        locate_dag: true,
        operator_name: "TableSink0",
        stage_name: "stg0",
        duration: "0ms",
        more_fields: { inputOutputStats: { outputRowCount: "0" }, rowCount: { sum: "0" } },
      },
    ])
  })
})
