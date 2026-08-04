import { describe, test, expect } from "bun:test"
import {
  staticPartitionColumn,
  parseDynamicPartition,
  appendPartitionedBy,
  stripPrimaryKey,
  generateSingleContent,
} from "../src/commands/integration.ts"

const SRC = { id: 28862, name: "taxi_data", dsType: 5, schema: "tc_demo", table: "yellow_taxi_00" }
const SINK = { id: 1418, name: "LAKEHOUSE_wanxin_test_08", dsType: 1, schema: "public", table: "ods_taxi_yellow_taxi_00_di" }
const sourceCols = [{ name: "id", type: "INT UNSIGNED" }, { name: "vendorid", type: "INT" }, { name: "tpep_pickup_datetime", type: "BIGINT" }]
const sinkCols = [{ name: "id", type: "bigint" }, { name: "vendorid", type: "int" }, { name: "tpep_pickup_datetime", type: "bigint" }]

function job(content: ReturnType<typeof generateSingleContent>) {
  return (content.jobs as Record<string, unknown>[])[0]
}

describe("partition spec parsing", () => {
  test("staticPartitionColumn extracts left side of first expr", () => {
    expect(staticPartitionColumn(["dt=${bizdate}"])).toBe("dt")
    expect(staticPartitionColumn(["ds=${bizdate}"])).toBe("ds")
    expect(staticPartitionColumn([])).toBeUndefined()
  })

  test("parseDynamicPartition handles col:src and bare src", () => {
    expect(parseDynamicPartition("dt:tpep_pickup_datetime")).toEqual({ column: "dt", sourceColumn: "tpep_pickup_datetime" })
    expect(parseDynamicPartition("create_time")).toEqual({ column: "dt", sourceColumn: "create_time" })
    expect(parseDynamicPartition("ds:update_time")).toEqual({ column: "ds", sourceColumn: "update_time" })
  })

  test("appendPartitionedBy adds clause, stripping trailing semicolon", () => {
    expect(appendPartitionedBy("CREATE TABLE public.t (id BIGINT)", "dt")).toBe("CREATE TABLE public.t (id BIGINT)\nPARTITIONED BY (dt STRING)")
    expect(appendPartitionedBy("CREATE TABLE public.t (id BIGINT);", "dt")).toBe("CREATE TABLE public.t (id BIGINT)\nPARTITIONED BY (dt STRING)")
  })

  test("stripPrimaryKey removes standalone, leading, and inline PK clauses", () => {
    expect(stripPrimaryKey("CREATE TABLE `t` (`id` INT, `name` VARCHAR(50), PRIMARY KEY (`id`))").toUpperCase()).not.toContain("PRIMARY KEY")
    expect(stripPrimaryKey("CREATE TABLE t (id INT, dt STRING, PRIMARY KEY (id, dt))").toUpperCase()).not.toContain("PRIMARY KEY")
    const inline = stripPrimaryKey("CREATE TABLE t (id INT PRIMARY KEY, name VARCHAR(50))")
    expect(inline.toUpperCase()).not.toContain("PRIMARY KEY")
    expect(inline).toContain("id INT")
    expect(inline).toContain("name VARCHAR(50)")
    expect(stripPrimaryKey("CREATE TABLE t (id INT, name VARCHAR(50))")).toBe("CREATE TABLE t (id INT, name VARCHAR(50))")
  })
})

describe("generateSingleContent — no partition (original behavior unchanged)", () => {
  test("does not add partition column, mapping, or sink.params.partitions", () => {
    const sink = job(generateSingleContent({ source: SRC, sink: SINK, sourceColumns: sourceCols, sinkColumns: sinkCols })).sink as Record<string, unknown>
    expect((sink.params as Record<string, unknown>).partitions).toBeUndefined()
    expect((sink.params as Record<string, unknown>).is_partition).toBe(false)
    expect((sink.columns as unknown[]).length).toBe(3)
  })
})

describe("generateSingleContent — static partition", () => {
  test("writes sink.params.partitions wrapped, no extra column", () => {
    const j = job(generateSingleContent({ source: SRC, sink: SINK, sourceColumns: sourceCols, sinkColumns: sinkCols, partitions: ["dt=${bizdate}"] }))
    const sink = j.sink as Record<string, unknown>
    expect((sink.params as Record<string, unknown>).partitions).toEqual([["dt=${bizdate}"]])
    expect((sink.columns as unknown[]).length).toBe(3)
    expect(j.columnMapping).not.toHaveProperty("dt")
  })
})

describe("generateSingleContent — dynamic partition (B semantics)", () => {
  test("in-place dt replacement + appended duplicate on both sides + dual mapping", () => {
    const j = job(generateSingleContent({
      source: SRC, sink: SINK, sourceColumns: sourceCols, sinkColumns: sinkCols,
      dynamicPartition: { column: "dt", sourceColumn: "tpep_pickup_datetime" },
    }))
    const sink = j.sink as Record<string, unknown>
    const source = j.source as Record<string, unknown>
    const sinkColumns = sink.columns as Record<string, unknown>[]
    const sourceColumns = source.columns as Record<string, unknown>[]

    // No sink.params.partitions for dynamic mode; is_partition stays false.
    expect((sink.params as Record<string, unknown>).partitions).toBeUndefined()

    // source: original time col retained + a trailing duplicate with inputType:default.
    expect(sourceColumns.filter((c) => c.name === "tpep_pickup_datetime").length).toBe(2)
    expect(sourceColumns[sourceColumns.length - 1].name).toBe("tpep_pickup_datetime")
    expect(sourceColumns[sourceColumns.length - 1].inputType).toBe("default")

    // sink: exactly one partition column named dt, string type, NO inputType, at the mapped index (2).
    const partCols = sinkColumns.filter((c) => c.partitionColumn === true)
    expect(partCols.length).toBe(1)
    expect(partCols[0].name).toBe("dt")
    expect(partCols[0].type).toBe("string")
    expect(partCols[0].inputType).toBeUndefined()
    expect(sinkColumns[2].name).toBe("dt")
    // trailing appended duplicate of the original sink column (inputType:default).
    expect(sinkColumns[sinkColumns.length - 1].name).toBe("tpep_pickup_datetime")
    expect(sinkColumns[sinkColumns.length - 1].inputType).toBe("default")

    // dual mapping: both dt and the original sink col map from the source time column.
    const mapping = j.columnMapping as Record<string, string>
    expect(mapping.dt).toBe("tpep_pickup_datetime")
    expect(mapping.tpep_pickup_datetime).toBe("tpep_pickup_datetime")
  })

  test("missing source column returns an error payload", () => {
    const res = generateSingleContent({
      source: SRC, sink: SINK, sourceColumns: sourceCols, sinkColumns: sinkCols,
      dynamicPartition: { column: "dt", sourceColumn: "nonexistent" },
    }) as Record<string, unknown>
    expect(res.code).toBe("400")
    expect(String(res.message)).toContain("nonexistent")
  })
})

describe("source-side partitions (lakehouse → mysql)", () => {
  // Lakehouse source (dsType 1) → MySQL sink (dsType 5), with a partitioned source table.
  const LAKE_SRC = { id: 1418, name: "LAKEHOUSE_wanxin_test_08", dsType: 1, schema: "ods", table: "employees" }
  const MYSQL_SINK = { id: 20261, name: "xl_test_mysql8", dsType: 5, schema: "automated_test", table: "auto_mysql_sink" }
  const srcCols = [{ name: "employee_id", type: "int" }, { name: "dt", type: "string" }]
  const snkCols = [{ name: "employee_id", type: "INT" }, { name: "dt", type: "VARCHAR" }]

  test("writes source.params.partitions as [[\"dt=...\"]] and flags the partition column", () => {
    const content = generateSingleContent({
      source: LAKE_SRC, sink: MYSQL_SINK, sourceColumns: srcCols, sinkColumns: snkCols,
      writeMode: "APPEND", sourcePartitions: ["dt=2026-08-04"],
    })
    const j = job(content)
    const sourceParams = (j.source as Record<string, unknown>).params as Record<string, unknown>
    expect(sourceParams.partitions).toEqual([["dt=2026-08-04"]])
    const cols = (j.source as Record<string, unknown>).columns as Record<string, unknown>[]
    const dtCol = cols.find((c) => c.name === "dt")
    expect(dtCol?.partitionColumn).toBe(true)
    // sink params carry no source-side partitions.
    expect(((j.sink as Record<string, unknown>).params as Record<string, unknown>).partitions).toBeUndefined()
  })

  test("supports a scheduling-param variable value (dt=${bizdate})", () => {
    const content = generateSingleContent({
      source: LAKE_SRC, sink: MYSQL_SINK, sourceColumns: srcCols, sinkColumns: snkCols,
      sourcePartitions: ["dt=${bizdate}"],
    })
    const sourceParams = (job(content).source as Record<string, unknown>).params as Record<string, unknown>
    expect(sourceParams.partitions).toEqual([["dt=${bizdate}"]])
  })

  test("no source partitions → source.params has no partitions key", () => {
    const content = generateSingleContent({
      source: LAKE_SRC, sink: MYSQL_SINK, sourceColumns: srcCols, sinkColumns: snkCols,
    })
    const sourceParams = (job(content).source as Record<string, unknown>).params as Record<string, unknown>
    expect(sourceParams.partitions).toBeUndefined()
  })
})

describe("elasticsearch source (es → lakehouse)", () => {
  const ES_SRC = { id: 34444, name: "auto_elasticSearch", dsType: 13, schema: "ignored", table: "demo_es_source" }
  const LAKE_SINK = { id: 26593, name: "LAKEHOUSE_smoke", dsType: 1, schema: "automated_test", table: "demo_es_sink" }
  const esSrcCols = [{ name: "keyword", type: "text" }, { name: "long", type: "long" }]
  const lakeSinkCols = [{ name: "keyword", type: "string" }, { name: "long", type: "bigint" }]

  test("ES source sets namespace/database to '--' and writes filter + batchSize", () => {
    const content = generateSingleContent({
      source: ES_SRC, sink: LAKE_SINK, sourceColumns: esSrcCols, sinkColumns: lakeSinkCols,
      writeMode: "OVERWRITE",
    })
    const j = job(content)
    const src = j.source as Record<string, unknown>
    expect(src.namespace).toBe("--")
    const params = src.params as Record<string, unknown>
    expect(params.database).toBe("--")
    expect(params.filter).toBe("")
    expect(params.batchSize).toBe(10)
  })

  test("ES filter + batchSize overrides are honored", () => {
    const content = generateSingleContent({
      source: ES_SRC, sink: LAKE_SINK, sourceColumns: esSrcCols, sinkColumns: lakeSinkCols,
      esFilter: "status:active", esBatchSize: 500,
    })
    const params = (job(content).source as Record<string, unknown>).params as Record<string, unknown>
    expect(params.filter).toBe("status:active")
    expect(params.batchSize).toBe(500)
  })

  test("non-ES source has no filter/batchSize and keeps its real schema", () => {
    const content = generateSingleContent({
      source: SRC, sink: SINK, sourceColumns: sourceCols, sinkColumns: sinkCols,
    })
    const src = job(content).source as Record<string, unknown>
    const params = src.params as Record<string, unknown>
    expect(params.filter).toBeUndefined()
    expect(params.batchSize).toBeUndefined()
    expect(src.namespace).toBe("tc_demo")
  })
})

describe("elasticsearch sink (lakehouse → es)", () => {
  const LAKE_SRC = { id: 1418, name: "LAKEHOUSE_wanxin", dsType: 1, schema: "aaa", table: "complement_task" }
  const ES_SINK = { id: 28366, name: "tianzhu_es", dsType: 13, schema: "public", table: "t1_entity_meta_1" }
  const srcCols = [{ name: "id", type: "bigint" }, { name: "tenant_id", type: "bigint" }]
  const esSinkCols = [{ name: "applyPermission", type: "nested" }, { name: "columnFilterInfo", type: "text" }]

  test("ES sink omits namespace/database and writeMode, writes batchSize + idGenerateRule", () => {
    const content = generateSingleContent({
      source: LAKE_SRC, sink: ES_SINK, sourceColumns: srcCols, sinkColumns: esSinkCols,
      writeMode: "OVERWRITE",
    })
    const sink = job(content).sink as Record<string, unknown>
    expect(sink.namespace).toBeUndefined()
    const params = sink.params as Record<string, unknown>
    expect(params.database).toBeUndefined()
    expect(params.writeMode).toBeUndefined()
    expect(params.outputMode).toBeUndefined()
    expect(params.batchSize).toBe(10000)
    expect(params.idGenerateRule).toBe("NONE")
    expect(params.is_partition).toBe(false)
    // source side is a normal lakehouse source.
    expect((job(content).source as Record<string, unknown>).namespace).toBe("aaa")
  })

  test("ES sink batchSize / idGenerateRule overrides are honored", () => {
    const content = generateSingleContent({
      source: LAKE_SRC, sink: ES_SINK, sourceColumns: srcCols, sinkColumns: esSinkCols,
      esSinkBatchSize: 500, esSinkIdRule: "PRIMARY_KEY",
    })
    const params = (job(content).sink as Record<string, unknown>).params as Record<string, unknown>
    expect(params.batchSize).toBe(500)
    expect(params.idGenerateRule).toBe("PRIMARY_KEY")
  })
})

describe("kafka sink (lakehouse → kafka)", () => {
  const LAKE_SRC = { id: 1418, name: "LAKEHOUSE_wanxin", dsType: 1, schema: "aaa", table: "complement_task" }
  const KAFKA_SINK = { id: 26590, name: "iol_event_hub", dsType: 2, schema: "public", table: "hotel-search-requests" }
  const srcCols = [{ name: "id", type: "bigint" }, { name: "env", type: "string" }]
  const kafkaSinkCols = [{ name: "id", type: "BIGINT" }, { name: "env", type: "STRING" }]

  test("Kafka sink uses '--' namespace/database, json codec, no writeMode", () => {
    const content = generateSingleContent({
      source: LAKE_SRC, sink: KAFKA_SINK, sourceColumns: srcCols, sinkColumns: kafkaSinkCols,
      writeMode: "OVERWRITE",
    })
    const sink = job(content).sink as Record<string, unknown>
    expect(sink.namespace).toBe("--")
    const params = sink.params as Record<string, unknown>
    expect(params.database).toBe("--")
    expect(params.codec).toBe("json")
    expect(params.writeMode).toBeUndefined()
    expect(params.outputMode).toBeUndefined()
    expect(params.batchSize).toBeUndefined()
    expect(params.is_partition).toBe(false)
    // source side is a normal lakehouse source.
    expect((job(content).source as Record<string, unknown>).namespace).toBe("aaa")
  })
})

describe("kafka source (kafka → lakehouse)", () => {
  const KAFKA_SRC = { id: 26590, name: "iol_event_hub", dsType: 2, schema: "public", table: "hotel-search-requests" }
  const LAKE_SINK = { id: 1418, name: "LAKEHOUSE_wanxin", dsType: 1, schema: "aaa", table: "mn_01" }
  const srcCols = [{ name: "__offset__", type: "LONG" }]
  const lakeSinkCols = [{ name: "a", type: "int" }]

  test("Kafka source uses '--' namespace, group-offsets mode with groupId + json codec", () => {
    const content = generateSingleContent({
      source: KAFKA_SRC, sink: LAKE_SINK, sourceColumns: srcCols, sinkColumns: lakeSinkCols,
      kafkaSourceMode: "group-offsets", kafkaSourceGroupId: "test_01",
    })
    const src = job(content).source as Record<string, unknown>
    expect(src.namespace).toBe("--")
    const params = src.params as Record<string, unknown>
    expect(params.database).toBe("--")
    expect(params.mode).toBe("group-offsets")
    expect(params.codec).toBe("json")
    expect(params.groupId).toBe("test_01")
    expect(params.endMode).toBe("period")  // default task-end strategy
  })

  test("earliest-offset mode still carries groupId (required for all modes)", () => {
    const content = generateSingleContent({
      source: KAFKA_SRC, sink: LAKE_SINK, sourceColumns: srcCols, sinkColumns: lakeSinkCols,
      kafkaSourceMode: "earliest-offset", kafkaSourceGroupId: "lh_demo_group",
    })
    const params = (job(content).source as Record<string, unknown>).params as Record<string, unknown>
    expect(params.mode).toBe("earliest-offset")
    expect(params.groupId).toBe("lh_demo_group")
    expect(params.endMode).toBe("period")
  })

  test("endMode override is honored", () => {
    const content = generateSingleContent({
      source: KAFKA_SRC, sink: LAKE_SINK, sourceColumns: srcCols, sinkColumns: lakeSinkCols,
      kafkaSourceMode: "latest-offset", kafkaSourceGroupId: "g1", kafkaSourceEndMode: "latest",
    })
    const params = (job(content).source as Record<string, unknown>).params as Record<string, unknown>
    expect(params.endMode).toBe("latest")
  })
})
