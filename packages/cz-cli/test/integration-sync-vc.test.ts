import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const home = mkdtempSync(join(tmpdir(), "cz-cli-integration-vc-"))
const profileDir = join(home, ".clickzetta")
const profileFile = join(profileDir, "profiles.toml")

const saveContentCalls: Array<Record<string, unknown>> = []
let vclusters: Array<{ id: string; name: string; type: string }> = []
// adhocConfigs the mocked getTaskDetail reports as already persisted on the task (for edit).
let existingTaskAdhoc: string | undefined
// Controls single-table setup probing: whether the sink table exists, and getDdl call count.
let sinkTableExists = true
let getDdlCalls = 0
// Sink columns returned by getColumnMapMeta, and CREATE TABLE SQLs executed against a sink.
let metaSinkColumns: Array<Record<string, unknown>> = [{ name: "id" }]
const createTableSqls: string[] = []

const actualSdk = await import("@clickzetta/sdk")
const actualResolver = await import("../src/resolver.ts")

// bun's mock.module is process-global and last-write-wins; re-installing in beforeEach
// keeps this file's SDK mock authoritative even when another test file also mocks the SDK.
function installSdkMock() {
  mock.module("@clickzetta/sdk", () => ({
  ...actualSdk,
  listVclusters: async () => vclusters,
  resolveVclusterId: async (_c: unknown, name: string) =>
    vclusters.find((v) => v.name === name || v.id === name)?.id,
  saveTaskContent: async (_config: Record<string, unknown>, params: Record<string, unknown>) => {
    saveContentCalls.push(params)
    return { data: true }
  },
  // Task detail carries existing content (a single-table job) + any bound adhocConfigs.
  getTaskDetail: async (_config: unknown, fileId: number) => ({
    data: {
      id: fileId,
      ...(existingTaskAdhoc !== undefined && { adhocConfigs: existingTaskAdhoc }),
      content: JSON.stringify({
        jobs: [{ source: { dataObject: "t1", namespace: "db1" }, sink: { dataObject: "t1", namespace: "public" }, columnMapping: { id: "id" } }],
      }),
    },
  }),
  // Probe endpoints used by single-table setup: schema/table existence, DDL, column meta.
  studioRequest: async (_c: unknown, path: string, body?: Record<string, unknown>) => {
    if (path.includes("getColumnMapMeta")) {
      return { data: { sourceMeta: { columns: [{ name: "id" }] }, sinkMeta: { columns: metaSinkColumns } } }
    }
    if (path.includes("getDdl")) { getDdlCalls++; return { data: "CREATE TABLE db1.t1 (id BIGINT)" } }
    if (path.includes("ai/mcp/execute")) {
      const sql = String(body?.sql ?? "")
      // SHOW TABLES → controls whether the sink table "exists"; other execs (schema, create) are no-ops.
      if (/SHOW TABLES/i.test(sql)) return { data: { rows: sinkTableExists ? [["t1"]] : [] } }
      if (/CREATE TABLE/i.test(sql)) createTableSqls.push(sql)
      return { data: { rows: [["dummy"]] } }
    }
    return { data: null }
  },
  }))
}
installSdkMock()

const actualStudioContext = await import("../src/commands/studio-context.ts")
mock.module("../src/commands/studio-context.js", () => ({
  ...actualStudioContext,
  getStudioContext: async () => ({
    projectId: 1417759,
    workspaceId: 1,
    userId: "studi_test_1",
    instanceName: "tmwmzxzs",
    workspaceName: "quick_start",
    baseUrl: "https://api.example.com",
  }),
}))

const actualDatasource = await import("../src/commands/datasource.ts")
const DS_BY_NAME: Record<string, { id: number; name: string; dsType: number }> = {
  mysql_src: { id: 100, name: "mysql_src", dsType: 5 },
  lakehouse_sink: { id: 200, name: "lakehouse_sink", dsType: 1 },
  lakehouse_src: { id: 300, name: "lakehouse_src", dsType: 1 },
  mysql_sink: { id: 400, name: "mysql_sink", dsType: 5 },
  es_src: { id: 500, name: "es_src", dsType: 13 },
  es_sink: { id: 600, name: "es_sink", dsType: 13 },
  kafka_sink: { id: 700, name: "kafka_sink", dsType: 2 },
  kafka_src: { id: 800, name: "kafka_src", dsType: 2 },
}
mock.module("../src/commands/datasource.js", () => ({
  ...actualDatasource,
  resolveDatasource: async (_c: unknown, nameOrId: string) =>
    DS_BY_NAME[nameOrId] ?? { id: 200, name: "lakehouse_sink", dsType: 1 },
}))

mock.module("../src/resolver.js", () => ({
  ...actualResolver,
  resolveTaskId: async (_config: unknown, nameOrId: string) =>
    nameOrId === "multi_task" ? 555001 : Number(nameOrId),
}))

mock.module("../src/logger.js", () => ({ logOperation: () => {} }))

const actualStudioUrl = await import("../src/commands/studio-url.ts")
mock.module("../src/commands/studio-url.js", () => ({
  ...actualStudioUrl,
  studioUrl: (_c: unknown, fileId: number) => `https://studio.example/task/${fileId}`,
}))

const { execute } = await import("../src/execute.ts")

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, unknown>
}

beforeEach(() => {
  installSdkMock()
  saveContentCalls.length = 0
  existingTaskAdhoc = undefined
  sinkTableExists = true
  getDdlCalls = 0
  metaSinkColumns = [{ name: "id" }]
  createTableSqls.length = 0
  vclusters = [
    { id: "vc-int-1", name: "SYNC_VC", type: "INTEGRATION" },
    { id: "vc-gen-1", name: "GENERAL_VC", type: "GENERAL" },
  ]
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(profileFile, "[profiles.test]\npat = 'pat'\nworkspace = 'quick_start'\ninstance = 'tmwmzxzs'\n")
  process.env.CLICKZETTA_TEST_HOME = home
})

afterAll(() => {
  delete process.env.CLICKZETTA_TEST_HOME
  rmSync(home, { recursive: true, force: true })
})

const BASE =
  "task integration setup multi_task --sync-type multi " +
  "--source-datasource mysql_src --source-schema db1 --source-tables t1,t2 " +
  "--sink-datasource lakehouse_sink --sink-schema public --format json"

describe("integration setup: sync VC persistence", () => {
  test("persists adhocConfigs with adhocVcCode/adhocVcId for an INTEGRATION VC", async () => {
    const result = await execute(`${BASE} --vc SYNC_VC`)
    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)

    expect(saveContentCalls.length).toBe(1)
    const saved = saveContentCalls[0]!
    expect(saved.adhocConfigs).toBeDefined()
    const adhoc = JSON.parse(String(saved.adhocConfigs)) as Record<string, unknown>
    expect(adhoc).toMatchObject({
      multiDataSource: [],
      schema: "public",
      adhocVcCode: "SYNC_VC",
      adhocVcId: "vc-int-1",
    })
  })

  test("rejects a non-INTEGRATION VC and lists available sync VCs", async () => {
    const result = await execute(`${BASE} --vc GENERAL_VC`)
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain("INTEGRATION")
    expect(result.output).toContain("SYNC_VC")
    expect(saveContentCalls.length).toBe(0)
  })

  test("auto-picks the sole INTEGRATION VC when none is provided", async () => {
    const result = await execute(BASE)
    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(saveContentCalls.length).toBe(1)
    const adhoc = JSON.parse(String(saveContentCalls[0]!.adhocConfigs)) as Record<string, unknown>
    expect(adhoc).toMatchObject({ adhocVcCode: "SYNC_VC", adhocVcId: "vc-int-1" })
  })

  test("errors when no INTEGRATION VC exists in the workspace", async () => {
    vclusters = [{ id: "vc-gen-1", name: "GENERAL_VC", type: "GENERAL" }]
    const result = await execute(BASE)
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain("INTEGRATION")
    expect(saveContentCalls.length).toBe(0)
  })

  test("errors and lists options when multiple INTEGRATION VCs exist and none is chosen", async () => {
    vclusters = [
      { id: "vc-int-1", name: "SYNC_VC", type: "INTEGRATION" },
      { id: "vc-int-2", name: "SYNC_VC_2", type: "INTEGRATION" },
    ]
    const result = await execute(BASE)
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain("SYNC_VC")
    expect(result.output).toContain("SYNC_VC_2")
    expect(saveContentCalls.length).toBe(0)
  })

  test("whole_db sync also persists the INTEGRATION sync VC", async () => {
    const result = await execute(
      "task integration setup multi_task --sync-type whole_db " +
        "--source-datasource mysql_src --source-schema db1 --source-dbs db1,db2 " +
        "--sink-datasource lakehouse_sink --sink-schema public --vc SYNC_VC --format json",
    )
    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    const adhoc = JSON.parse(String(saveContentCalls[0]!.adhocConfigs)) as Record<string, unknown>
    expect(adhoc).toMatchObject({ adhocVcCode: "SYNC_VC", adhocVcId: "vc-int-1" })
    const data = firstJson(result.output).data as Record<string, unknown>
    expect(data.vc).toBe("SYNC_VC")
  })
})

const SINGLE_BASE =
  "task integration setup 12345 --sync-type single " +
  "--source-datasource lakehouse_src --source-schema db1 --source-table t1 " +
  "--sink-datasource mysql_sink --sink-schema public --format json"

describe("integration setup: single-table sync VC", () => {
  test("single-table setup persists adhocConfigs (explicit --vc)", async () => {
    const result = await execute(`${SINGLE_BASE} --vc SYNC_VC`)
    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(saveContentCalls.length).toBe(1)
    const adhoc = JSON.parse(String(saveContentCalls[0]!.adhocConfigs)) as Record<string, unknown>
    expect(adhoc).toMatchObject({ adhocVcCode: "SYNC_VC", adhocVcId: "vc-int-1" })
  })

  test("single-table setup auto-picks the sole INTEGRATION VC", async () => {
    const result = await execute(SINGLE_BASE)
    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    const adhoc = JSON.parse(String(saveContentCalls[0]!.adhocConfigs)) as Record<string, unknown>
    expect(adhoc.adhocVcCode).toBe("SYNC_VC")
  })

  test("single-table setup rejects a non-INTEGRATION VC", async () => {
    const result = await execute(`${SINGLE_BASE} --vc GENERAL_VC`)
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain("INTEGRATION")
    expect(saveContentCalls.length).toBe(0)
  })
})

describe("integration setup: sink table auto-create guard", () => {
  // Lakehouse source → Lakehouse sink; auto-create is allowed.
  const LAKE_TO_LAKE =
    "task integration setup 12345 --sync-type single " +
    "--source-datasource lakehouse_src --source-schema db1 --source-table t1 " +
    "--sink-datasource lakehouse_sink --sink-schema public --sink-table t1 --format json"

  test("non-Lakehouse sink with missing table errors and does NOT call getDdl", async () => {
    sinkTableExists = false
    // SINGLE_BASE sink is mysql_sink (dsType 5).
    const result = await execute(SINGLE_BASE)
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain("SINK_TABLE_REQUIRED")
    expect(getDdlCalls).toBe(0)
    expect(saveContentCalls.length).toBe(0)
  })

  test("Lakehouse sink with missing table auto-creates via getDdl", async () => {
    sinkTableExists = false
    const result = await execute(LAKE_TO_LAKE)
    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(getDdlCalls).toBe(1)
    expect(saveContentCalls.length).toBe(1)
  })

  test("non-Lakehouse sink with existing table skips creation and succeeds", async () => {
    sinkTableExists = true
    const result = await execute(SINGLE_BASE)
    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(getDdlCalls).toBe(0)
    expect(saveContentCalls.length).toBe(1)
  })
})

describe("integration edit: sync VC handling", () => {
  test("edit preserves the existing bound VC when --vc is omitted", async () => {
    existingTaskAdhoc = JSON.stringify({ multiDataSource: [], schema: "public", adhocVcCode: "SYNC_VC", adhocVcId: "vc-int-1" })
    const result = await execute("task integration edit 12345 --parallelism 2 --format json")
    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(saveContentCalls.length).toBe(1)
    // The previously bound VC is carried through unchanged.
    expect(saveContentCalls[0]!.adhocConfigs).toBe(existingTaskAdhoc)
  })

  test("edit --vc overrides the bound VC (validated as INTEGRATION)", async () => {
    existingTaskAdhoc = JSON.stringify({ adhocVcCode: "OLD_VC" })
    const result = await execute("task integration edit 12345 --vc SYNC_VC --format json")
    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    const adhoc = JSON.parse(String(saveContentCalls[0]!.adhocConfigs)) as Record<string, unknown>
    expect(adhoc).toMatchObject({ adhocVcCode: "SYNC_VC", adhocVcId: "vc-int-1" })
  })

  test("edit --vc rejects a non-INTEGRATION VC", async () => {
    const result = await execute("task integration edit 12345 --vc GENERAL_VC --format json")
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain("INTEGRATION")
    expect(saveContentCalls.length).toBe(0)
  })
})

describe("integration setup: elasticsearch → lakehouse", () => {
  const ES_BASE =
    "task integration setup 12345 --sync-type single " +
    "--source-datasource es_src --source-table demo_es_index " +
    "--sink-datasource lakehouse_sink --sink-schema automated_test --sink-table demo_es_sink " +
    "--write-mode OVERWRITE --format json"

  test("builds the Lakehouse sink from column metadata, never calls getDdl, saves ES source params", async () => {
    sinkTableExists = false
    metaSinkColumns = [{ name: "keyword", type: "string" }, { name: "long", type: "bigint" }]
    const result = await execute(`${ES_BASE} --source-filter 'status:active' --source-batch-size 50`)
    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    // Sink table built from metadata columns, not a mirrored source DDL.
    expect(getDdlCalls).toBe(0)
    expect(createTableSqls.length).toBe(1)
    expect(createTableSqls[0]).toContain("`keyword` string")
    expect(createTableSqls[0]).toContain("`long` bigint")
    // Saved content carries ES-shaped source.params.
    expect(saveContentCalls.length).toBe(1)
    const raw = saveContentCalls[0]!.dataFileContent
    const content = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>
    const job0 = (content.jobs as Record<string, unknown>[])[0]!
    const params = (job0.source as Record<string, unknown>).params as Record<string, unknown>
    expect(params.database).toBe("--")
    expect(params.filter).toBe("status:active")
    expect(params.batchSize).toBe(50)
    expect((job0.source as Record<string, unknown>).namespace).toBe("--")
  })

  test("existing Lakehouse sink table skips creation", async () => {
    sinkTableExists = true
    metaSinkColumns = [{ name: "keyword", type: "string" }]
    const result = await execute(ES_BASE)
    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(createTableSqls.length).toBe(0)
    expect(saveContentCalls.length).toBe(1)
  })

  test("no sink column metadata → SINK_TABLE_REQUIRED", async () => {
    sinkTableExists = false
    metaSinkColumns = []
    const result = await execute(ES_BASE)
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain("SINK_TABLE_REQUIRED")
    expect(saveContentCalls.length).toBe(0)
  })
})

describe("integration setup: lakehouse → elasticsearch", () => {
  const LES_BASE =
    "task integration setup 12345 --sync-type single " +
    "--source-datasource lakehouse_src --source-schema aaa --source-table complement_task " +
    "--sink-datasource es_sink --sink-table t1_entity_meta_1 " +
    "--format json"

  test("saves ES-shaped sink content and never builds a target table", async () => {
    // ES sink metadata present → index exists.
    metaSinkColumns = [{ name: "applyPermission", type: "nested" }, { name: "columnFilterInfo", type: "text" }]
    const result = await execute(LES_BASE)
    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(getDdlCalls).toBe(0)
    expect(createTableSqls.length).toBe(0)
    expect(saveContentCalls.length).toBe(1)
    const raw = saveContentCalls[0]!.dataFileContent
    const content = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>
    const sink = ((content.jobs as Record<string, unknown>[])[0]!.sink) as Record<string, unknown>
    expect(sink.namespace).toBeUndefined()
    const params = sink.params as Record<string, unknown>
    expect(params.database).toBeUndefined()
    expect(params.batchSize).toBe(10000)
    expect(params.idGenerateRule).toBe("NONE")
  })

  test("--sink-batch-size / --sink-id-rule are honored", async () => {
    metaSinkColumns = [{ name: "applyPermission", type: "nested" }]
    const result = await execute(`${LES_BASE} --sink-batch-size 2000 --sink-id-rule PRIMARY_KEY`)
    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    const raw = saveContentCalls[0]!.dataFileContent
    const content = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>
    const params = (((content.jobs as Record<string, unknown>[])[0]!.sink) as Record<string, unknown>).params as Record<string, unknown>
    expect(params.batchSize).toBe(2000)
    expect(params.idGenerateRule).toBe("PRIMARY_KEY")
  })

  test("missing ES index (no sink columns) → SINK_INDEX_REQUIRED", async () => {
    metaSinkColumns = []
    const result = await execute(LES_BASE)
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain("SINK_INDEX_REQUIRED")
    expect(saveContentCalls.length).toBe(0)
  })
})

describe("integration setup: lakehouse → kafka", () => {
  const LK_BASE =
    "task integration setup 12345 --sync-type single " +
    "--source-datasource lakehouse_src --source-schema aaa --source-table complement_task " +
    "--sink-datasource kafka_sink --sink-table hotel-search-requests " +
    "--format json"

  test("saves Kafka-shaped sink content and never builds a topic", async () => {
    metaSinkColumns = [{ name: "id", type: "BIGINT" }, { name: "env", type: "STRING" }]
    const result = await execute(LK_BASE)
    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(getDdlCalls).toBe(0)
    expect(createTableSqls.length).toBe(0)
    expect(saveContentCalls.length).toBe(1)
    const raw = saveContentCalls[0]!.dataFileContent
    const content = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>
    const sink = ((content.jobs as Record<string, unknown>[])[0]!.sink) as Record<string, unknown>
    expect(sink.namespace).toBe("--")
    const params = sink.params as Record<string, unknown>
    expect(params.database).toBe("--")
    expect(params.codec).toBe("json")
    expect(params.writeMode).toBeUndefined()
  })

  test("missing Kafka topic (no sink columns) → SINK_TOPIC_REQUIRED", async () => {
    metaSinkColumns = []
    const result = await execute(LK_BASE)
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain("SINK_TOPIC_REQUIRED")
    expect(saveContentCalls.length).toBe(0)
  })
})

describe("integration setup: kafka → lakehouse", () => {
  const KL_BASE =
    "task integration setup 12345 --sync-type single " +
    "--source-datasource kafka_src --source-table hotel-search-requests " +
    "--sink-datasource lakehouse_sink --sink-schema aaa --sink-table mn_01 " +
    "--format json"

  test("group-offsets: builds Lakehouse sink from columns, never getDdl, saves Kafka source params", async () => {
    sinkTableExists = false
    metaSinkColumns = [{ name: "a", type: "int" }]
    const result = await execute(`${KL_BASE} --source-mode group-offsets --source-group-id test_01`)
    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    expect(getDdlCalls).toBe(0)
    expect(createTableSqls.length).toBe(1)
    expect(createTableSqls[0]).toContain("`a` int")
    const raw = saveContentCalls[0]!.dataFileContent
    const content = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>
    const src = ((content.jobs as Record<string, unknown>[])[0]!.source) as Record<string, unknown>
    expect(src.namespace).toBe("--")
    const params = src.params as Record<string, unknown>
    expect(params.mode).toBe("group-offsets")
    expect(params.groupId).toBe("test_01")
    expect(params.codec).toBe("json")
    expect(params.endMode).toBe("period")
  })

  test("a Kafka source without --source-group-id errors (any mode)", async () => {
    metaSinkColumns = [{ name: "a", type: "int" }]
    const result = await execute(KL_BASE)  // defaults to group-offsets, no group id
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain("source-group-id")
    expect(saveContentCalls.length).toBe(0)
  })

  test("earliest-offset also requires and carries a group id", async () => {
    sinkTableExists = false
    metaSinkColumns = [{ name: "a", type: "int" }]
    // Without a group id it must error, even for earliest-offset.
    const missing = await execute(`${KL_BASE} --source-mode earliest-offset`)
    expect(missing.exitCode).toBe(2)
    expect(missing.output).toContain("source-group-id")

    const result = await execute(`${KL_BASE} --source-mode earliest-offset --source-group-id lh_demo_group`)
    if (result.exitCode !== 0) console.log(result.output)
    expect(result.exitCode).toBe(0)
    const raw = saveContentCalls[0]!.dataFileContent
    const content = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>
    const params = (((content.jobs as Record<string, unknown>[])[0]!.source) as Record<string, unknown>).params as Record<string, unknown>
    expect(params.mode).toBe("earliest-offset")
    expect(params.groupId).toBe("lh_demo_group")
  })
})
