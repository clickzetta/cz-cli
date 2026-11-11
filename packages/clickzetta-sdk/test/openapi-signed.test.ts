import { afterEach, describe, expect, mock, test } from "bun:test"
import { createHmac } from "node:crypto"
import { openApiRequest, percentEncode, signOpenApiQuery } from "../src/openapi/signed.js"

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

describe("percentEncode", () => {
  test("encodes the characters encodeURIComponent leaves alone", () => {
    expect(percentEncode("a b!'()*~/")).toBe("a%20b%21%27%28%29%2A~%2F")
  })
})

describe("signOpenApiQuery", () => {
  const params = { SignatureNonce: "1234567890", Format: "JSON", Timestamp: "2026-11-03T08.00.00" }

  test("signs METHOD&%2F&encoded sorted query with HMAC-SHA1 keyed by secret&", () => {
    const query = "Format=JSON&SignatureNonce=1234567890&Timestamp=2026-11-03T08.00.00"
    const expected = createHmac("sha1", "sk-test&")
      .update(`POST&%2F&${encodeURIComponent(query)}`)
      .digest("base64")

    expect(signOpenApiQuery("POST", params, "sk-test")).toBe(expected)
  })

  test("URL-encodes the signature for non-POST methods only", () => {
    const get = signOpenApiQuery("GET", params, "sk-test")
    const raw = createHmac("sha1", "sk-test&")
      .update(`GET&%2F&${encodeURIComponent("Format=JSON&SignatureNonce=1234567890&Timestamp=2026-11-03T08.00.00")}`)
      .digest("base64")

    expect(get).toBe(encodeURIComponent(raw))
  })
})

describe("openApiRequest", () => {
  test("sends the signed query, the access key header and the JSON body", async () => {
    const fetchMock = mock(async () => new Response('{"code":0}', { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const resp = await openApiRequest(
      "https://api.test.invalid/",
      "/openapi/v2/realtime/getTableSyncStatus",
      { taskId: 1 },
      { accessKey: "ak-test", secretKey: "sk-test" },
      { now: new Date(Date.UTC(2026, 10, 3, 8, 0, 0)), nonce: "1234567890" },
    )

    expect(resp).toEqual({ status: 200, body: { code: 0 } })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe("https://api.test.invalid/openapi/v2/realtime/getTableSyncStatus")
    expect(parsed.searchParams.get("SignatureNonce")).toBe("1234567890")
    expect(parsed.searchParams.get("SignatureMethod")).toBe("HMAC-SHA1")
    expect(parsed.searchParams.get("Signature")).toBeTruthy()
    const headers = init.headers as Record<string, string>
    expect(headers.accessKey).toBe("ak-test")
    expect(JSON.stringify(headers)).not.toContain("sk-test")
    expect(init.body).toBe('{"taskId":1}')
  })

  test("returns non-JSON bodies as text", async () => {
    globalThis.fetch = (async () => new Response("bad gateway", { status: 502 })) as unknown as typeof fetch

    const resp = await openApiRequest("https://api.test.invalid", "/openapi/v2/di/listX", {}, { accessKey: "a", secretKey: "s" })

    expect(resp).toEqual({ status: 502, body: "bad gateway" })
  })

  test("redacts the access key, secret and signature from the response", async () => {
    let signature = ""
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      signature = new URL(url).searchParams.get("Signature") ?? ""
      const h = init.headers as Record<string, string>
      return new Response(JSON.stringify({ ak: h.accessKey, sign: h.sign, q: url, sk: "secret/key+12345" }), { status: 401 })
    }) as unknown as typeof fetch
    const resp = await openApiRequest("https://api.test.invalid", "/openapi/v2/di/listX", {}, {
      accessKey: "access-key-12345",
      secretKey: "secret/key+12345",
    })
    const text = JSON.stringify(resp.body)
    expect(signature.length).toBeGreaterThanOrEqual(8)
    for (const secret of ["access-key-12345", "secret/key+12345", signature, encodeURIComponent(signature)]) {
      expect(text).not.toContain(secret)
    }
    expect((resp.body as Record<string, string>).ak).toBe("***")
  })
})
