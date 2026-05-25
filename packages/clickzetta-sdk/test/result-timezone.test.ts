import { afterEach, describe, expect, mock, test } from "bun:test"
import { tableFromArrays, tableToIPC } from "apache-arrow"
import { parseJobResponse } from "../src/sql/poll.js"

const originalFetch = globalThis.fetch

function encodeArrowChunk(value: Date) {
  const table = tableFromArrays({ create_time: [value] })
  const bytes = tableToIPC(table, "stream")
  let bin = ""
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin)
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("parseJobResponse timezone handling", () => {
  test("embedded TEXT prefers metadata timeZone for TIMESTAMP_LTZ", async () => {
    const result = await parseJobResponse(
      {
        status: { state: "SUCCEEDED" },
        resultSet: {
          metadata: {
            format: "TEXT",
            timeZone: "Asia/Shanghai",
            fields: [{ name: "create_time", type: { category: "TIMESTAMP_LTZ" } }],
          },
          data: { data: [btoa("2026-05-22 05:18:36.963Z\n")] },
        },
      },
      { id: "job", workspace: "ws", instanceId: 1 },
    )
    expect(result.timeZone).toBe("Asia/Shanghai")
    expect(result.rows).toEqual([["2026-05-22T13:18:36.963"]])
  })

  test("embedded ARROW falls back to timezone hint for TIMESTAMP_LTZ", async () => {
    const result = await parseJobResponse(
      {
        status: { state: "SUCCEEDED" },
        resultSet: {
          metadata: {
            format: "ARROW",
            fields: [{ name: "create_time", type: { category: "TIMESTAMP_LTZ" } }],
          },
          data: { data: [encodeArrowChunk(new Date("2026-05-22T05:18:36.963Z"))] },
        },
      },
      { id: "job", workspace: "ws", instanceId: 1 },
      "Asia/Shanghai",
    )
    expect(result.timeZone).toBe("Asia/Shanghai")
    expect(result.rows).toEqual([["2026-05-22T13:18:36.963"]])
  })

  test("presigned TEXT uses resolved timezone during coercion", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("2026-05-22 05:18:36.963Z\n", { status: 200 })),
    ) as unknown as typeof fetch

    const result = await parseJobResponse(
      {
        status: { state: "SUCCEEDED" },
        resultSet: {
          metadata: {
            format: "TEXT",
            timeZone: "Asia/Shanghai",
            fields: [{ name: "create_time", type: { category: "TIMESTAMP_LTZ" } }],
          },
          location: { presignedUrls: ["https://example.com/result.txt"] },
        },
      },
      { id: "job", workspace: "ws", instanceId: 1 },
    )
    expect(result.rows).toEqual([["2026-05-22T13:18:36.963"]])
  })

  test("presigned ARROW uses resolved timezone during decoding", async () => {
    const bytes = Uint8Array.from(atob(encodeArrowChunk(new Date("2026-05-22T05:18:36.963Z"))), (c) => c.charCodeAt(0))
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(bytes, { status: 200 })),
    ) as unknown as typeof fetch

    const result = await parseJobResponse(
      {
        status: { state: "SUCCEEDED" },
        resultSet: {
          metadata: {
            format: "ARROW",
            timeZone: "Asia/Shanghai",
            fields: [{ name: "create_time", type: { category: "TIMESTAMP_LTZ" } }],
          },
          location: { presignedUrls: ["https://example.com/result.arrow"] },
        },
      },
      { id: "job", workspace: "ws", instanceId: 1 },
    )
    expect(result.rows).toEqual([["2026-05-22T13:18:36.963"]])
  })
})
