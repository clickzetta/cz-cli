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
