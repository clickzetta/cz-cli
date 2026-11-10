import { describe, it, expect } from "bun:test"
import { tableFromArrays, tableToIPC, CompressionType, RecordBatchStreamWriter, compressionRegistry, Utf8, Int32, Float64 } from "apache-arrow"
import zlib from "node:zlib"
import { decodeArrowPayload, fetchArrowFromUrls } from "../src/sql/arrow.js"

function encodeTable(data: {
  id: Int32Array
  name: string[]
  score: Float64Array
}): string {
  const table = tableFromArrays(data)
  const bytes = tableToIPC(table, "stream")
  // base64 via Buffer (Node/Bun)
  let bin = ""
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin)
}

describe("decodeArrowPayload (query_result.py:57-80)", () => {
  it("round-trips a small table", () => {
    const b64 = encodeTable({
      id: new Int32Array([1, 2, 3]),
      name: ["a", "b", "c"],
      score: new Float64Array([1.5, 2.5, 3.5]),
    })
    const columns = [
      { name: "id", type: "INT32" },
      { name: "name", type: "STRING" },
      { name: "score", type: "DOUBLE" },
    ]
    const { rows } = decodeArrowPayload([b64], columns)
    expect(rows.length).toBe(3)
    expect(rows[0]).toEqual([1, "a", 1.5])
    expect(rows[2]).toEqual([3, "c", 3.5])
  })

  it("returns empty rows when chunks is empty", () => {
    const { rows } = decodeArrowPayload([], [{ name: "x", type: "INT32" }])
    expect(rows).toEqual([])
  })

  it("resolves columns from schema when metadata is empty", () => {
    const b64 = encodeTable({
      id: new Int32Array([1]),
      name: ["a"],
      score: new Float64Array([1.0]),
    })
    const { columns, rows } = decodeArrowPayload([b64], [])
    expect(columns.map((c) => c.name)).toEqual(["id", "name", "score"])
    expect(rows.length).toBe(1)
  })
})

// The service writes `cz.storage.arrow.ipc.codec=zstd` results as Arrow IPC with
// ZSTD-compressed buffers; apache-arrow cannot read those without a registered codec
// ("Record batch is compressed but codec not found").
describe("compressed Arrow IPC", () => {
  // Written once by apache-arrow's RecordBatchStreamWriter with compressionType ZSTD
  // (id 1..5, name alpha..epsilon, score 1.5..5.5), then stored so the input does not
  // depend on the codec under test.
  const zstdStream = [
    "/////xABAAAQAAAAAAAKABAADgAHAAgACgAAAAAAAAEIAAAAAAAEAHD///8EAAAAAwAAALAAAABMAAAABAAAAGz///8QAAAAGAAA",
    "AAAAAAMcAAAABQAAAHNjb3JlAAAAAAAAAAAABgAIAAYABgAAAAAAAgAQABwACAAPABcAGAAEABAAEAAAADgAAAAUAAAAAAAAARgA",
    "AAAAAAAFGAAAAAQAAABuYW1lAAAAAAAAAAAEAAQABAAAAAgACAAAAAQACAAAAAQAAADE////AAAAASAAAAAQABQABAAAAA8AEAAA",
    "AAgAEAAAABAAAAAUAAAAAAAAAhgAAAACAAAAaWQAAAAAAAAIAAwACAAHAAgAAAAAAAABIAAAAP/////AAAAAFAAAAAAAAAAMABgA",
    "FgAPABAABAAMAAAASAAAAAAAAAAAAAACEAAAAAAABAAIAAgAAAAEAAgAAAAQAAAADAAeABAADAAIAAQADAAAACAAAAAkAAAAWAAA",
    "AAUAAAAAAAAAAAAAAAAABgAIAAcABgAAAAAAAAEDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAgAAAAAAAAACIA",
    "AAAAAAAAAAAAAAEAAAAFAAAAAAAAAAAAAAAAAAAA//////////8AAAAABQAAAAkAAAAOAAAAEwAAABoAAAD//////////2FscGhh",
    "YmV0YWdhbW1hZGVsdGFlcHNpbG9uAAAAAAAA/////wABAAAUAAAAAAAAAAwAGAAWAA8AEAAEAAwAAABwAAAAAAAAAAAAAAMUAAAA",
    "AAAEAAwAHgAQAAwACAAEAAwAAAAgAAAAJAAAAIgAAAAFAAAAAAAAAAAAAAAAAAYACAAHAAYAAAAAAAABBgAAAAAAAAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAABwAAAAAAAAAHAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAHAAAAAAAAAA8AAAAAAAAAAAAAAAAAAAAQAAAAAAA",
    "AAAqAAAAAAAAAAAAAAADAAAABQAAAAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAAAAAAFAAAAAAAAAAAAAAAAAAAA//////////8B",
    "AAAAAgAAAAMAAAAEAAAABQAAAAAAAAD//////////wAAAAABAAAAAgAAAAMAAAAEAAAAAAAAACIAAAAAAAAAKLUv/SAozQAAYAAA",
    "+D8ABEAADBIWQAUAIMtKXtAGkBEALAAAAAAAAP////8AAAAA",
  ].join("")
  const columns = [
    { name: "id", type: "INT32" },
    { name: "name", type: "STRING" },
    { name: "score", type: "DOUBLE" },
  ]

  it("decodes a ZSTD-compressed IPC stream", () => {
    const { rows } = decodeArrowPayload([zstdStream], columns)
    expect(rows).toEqual([
      [1, "alpha", 1.5],
      [2, "beta", 2.5],
      [3, "gamma", 3.5],
      [4, "delta", 4.5],
      [5, "epsilon", 5.5],
    ])
  })

  it("decodes a ZSTD-compressed stream fetched from a URL", async () => {
    const body = Buffer.from(zstdStream, "base64")
    const server = Bun.serve({ port: 0, fetch: () => new Response(body) })
    try {
      const { rows } = await fetchArrowFromUrls([`http://localhost:${server.port}/result`], columns)
      expect(rows).toEqual([
        [1, "alpha", 1.5],
        [2, "beta", 2.5],
        [3, "gamma", 3.5],
        [4, "delta", 4.5],
        [5, "epsilon", 5.5],
      ])
    } finally {
      await server.stop(true)
    }
  })

  it("decodes ZSTD batches with nulls and repetitive data", () => {
    const count = 2000
    const table = tableFromArrays({
      id: Int32Array.from({ length: count }, (_, i) => i),
      name: Array.from({ length: count }, (_, i) => (i % 7 === 0 ? null : `row-${i % 3}`)),
      score: Float64Array.from({ length: count }, (_, i) => i / 4),
    })
    // The shipped codec only decodes; give the writer an encoder for this test.
    const shipped = compressionRegistry.get(CompressionType.ZSTD)!
    compressionRegistry.set(CompressionType.ZSTD, {
      encode: (data) => zlib.zstdCompressSync(data),
      decode: shipped.decode,
    })
    const writer = new RecordBatchStreamWriter({ compressionType: CompressionType.ZSTD })
    try {
      writer.writeAll(table)
    } finally {
      compressionRegistry.set(CompressionType.ZSTD, shipped)
    }
    const { rows } = decodeArrowPayload([Buffer.from(writer.toUint8Array(true)).toString("base64")], columns)
    expect(rows.length).toBe(count)
    expect(rows[0]).toEqual([0, null, 0])
    expect(rows[1999]).toEqual([1999, "row-1", 499.75])
  })

  it("names the codec when the stream is LZ4_FRAME-compressed", () => {
    // No LZ4 encoder is available, so write with a stand-in whose output only needs to
    // look like an LZ4 frame; what is under test is the decode side.
    const shipped = compressionRegistry.get(CompressionType.LZ4_FRAME)!
    compressionRegistry.set(CompressionType.LZ4_FRAME, {
      encode: () => Uint8Array.from([0x04, 0x22, 0x4d, 0x18, 0x64, 0x40, 0xa7, 0, 0, 0, 0]),
      decode: shipped.decode,
    })
    const writer = new RecordBatchStreamWriter({ compressionType: CompressionType.LZ4_FRAME })
    try {
      writer.writeAll(tableFromArrays({ id: new Int32Array([1, 2, 3]) }))
    } finally {
      compressionRegistry.set(CompressionType.LZ4_FRAME, shipped)
    }
    const b64 = Buffer.from(writer.toUint8Array(true)).toString("base64")
    expect(() => decodeArrowPayload([b64], [{ name: "id", type: "INT32" }])).toThrow("LZ4_FRAME")
  })
})
