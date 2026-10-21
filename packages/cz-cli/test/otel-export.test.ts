import { expect, test } from "bun:test"
import { initOtelSdk } from "../src/opencode-plugin/otel/setup"

test("exports complete request attributes to an OTLP collector", async () => {
  const requests: Array<{
    resourceSpans?: Array<{
      scopeSpans: Array<{
        spans: Array<{
          attributes: Array<{ key: string; value: { stringValue?: string } }>
        }>
      }>
    }>
  }> = []
  const collector = Bun.serve({
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname === "/v1/traces") requests.push(await request.json())
      return Response.json({})
    },
  })
  const input = JSON.stringify([
    { role: "user", parts: [{ type: "text", content: "Original question" }] },
    { role: "assistant", parts: [{ type: "text", content: "x".repeat(200_000) }] },
  ])
  const sdk = await initOtelSdk(collector.url.toString().replace(/\/$/, ""), {}, { "service.name": "test" })
  try {
    const span = sdk.tracerProvider.getTracer("test").startSpan("chat test", {
      attributes: { "gen_ai.input.messages": input, "clickzetta.llm.request.body": input },
    })
    span.end()
    await sdk.shutdown()
    const spanAttributes = requests
      .flatMap((request) => request.resourceSpans ?? [])
      .flatMap((resource) => resource.scopeSpans)
      .flatMap((scope) => scope.spans)
      .flatMap((span) => span.attributes)
    expect(spanAttributes.find((attribute) => attribute.key === "gen_ai.input.messages")?.value.stringValue).toBe(input)
    expect(spanAttributes.find((attribute) => attribute.key === "clickzetta.llm.request.body")?.value.stringValue).toBe(
      input,
    )
  } finally {
    collector.stop(true)
  }
})
