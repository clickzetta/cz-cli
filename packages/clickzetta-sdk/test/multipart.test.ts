import { afterEach, expect, test } from "bun:test"

import { request } from "../src/client.js"
import { staticTokenSource } from "../src/auth/token.js"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function capture() {
  const calls: { headers: Record<string, string>; body: unknown }[] = []
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    calls.push({ headers: init.headers as Record<string, string>, body: init.body })
    return new Response(JSON.stringify({ code: 0, data: "ok" }))
  }) as typeof fetch
  return calls
}

const opts = { baseUrl: "https://region.invalid", tokens: staticTokenSource({ token: "tok", instanceId: 1, userId: 2 }) }

test("FormData is sent as is, without the JSON content type", async () => {
  const calls = capture()
  const form = new FormData()
  form.append("file", new Blob(["-----BEGIN CERTIFICATE-----"]), "ca.pem")
  await request(opts, "/upload", form)
  expect(calls[0]!.body).toBe(form)
  expect(Object.keys(calls[0]!.headers).map((name) => name.toLowerCase())).not.toContain("content-type")
  expect(calls[0]!.headers["x-clickzetta-token"]).toBe("tok")
})

test("a plain object body is still JSON", async () => {
  const calls = capture()
  await request(opts, "/json", { a: 1 })
  expect(calls[0]!.body).toBe('{"a":1}')
  expect(calls[0]!.headers["content-type"]).toBe("application/json")
})
