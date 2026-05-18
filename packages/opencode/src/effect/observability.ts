import { Effect, Layer, Logger } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { OtlpLogger, OtlpSerialization } from "effect/unstable/observability"
import * as EffectLogger from "./logger"
import { Flag } from "@/flag/flag"
import { InstallationChannel, InstallationVersion } from "@/installation/version"
import { getSessionSpanRef } from "@/plugin/otel/context"

const base = Flag.OTEL_EXPORTER_OTLP_ENDPOINT
export const enabled = !!base

const headers = Flag.OTEL_EXPORTER_OTLP_HEADERS
  ? Flag.OTEL_EXPORTER_OTLP_HEADERS.split(",").reduce(
      (acc, x) => {
        const [key, ...value] = x.split("=")
        acc[key] = value.join("=")
        return acc
      },
      {} as Record<string, string>,
    )
  : undefined

const resource = {
  serviceName: "opencode",
  serviceVersion: InstallationVersion,
  attributes: {
    "deployment.environment.name": InstallationChannel,
    "opencode.client": Flag.CLICKZETTA_CLIENT,
  },
}

function withSessionTraceFallback(inner: Logger.Logger<unknown, void>): Logger.Logger<unknown, void> {
  return Logger.make((options) => {
    if (!options.fiber.currentSpan) {
      const ref = getSessionSpanRef()
      if (ref) {
        const patched = Object.create(options.fiber)
        patched.currentSpan = { traceId: ref.traceId, spanId: ref.spanId }
        return inner.log({ ...options, fiber: patched })
      }
    }
    return inner.log(options)
  })
}

const logs = Logger.layer(
  [
    EffectLogger.logger,
    Effect.map(
      OtlpLogger.make({
        url: `${base}/v1/logs`,
        resource,
        headers,
      }),
      withSessionTraceFallback,
    ),
  ],
  { mergeWithExisting: false },
).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(FetchHttpClient.layer))

const traces = async () => {
  const NodeSdk = await import("@effect/opentelemetry/NodeSdk")
  const OTLP = await import("@opentelemetry/exporter-trace-otlp-http")
  const SdkBase = await import("@opentelemetry/sdk-trace-base")

  const { AsyncLocalStorageContextManager } = await import("@opentelemetry/context-async-hooks")
  const otelApi = await import("@opentelemetry/api")
  const mgr = new AsyncLocalStorageContextManager()
  mgr.enable()
  otelApi.context.setGlobalContextManager(mgr)

  return NodeSdk.layer(() => ({
    resource,
    spanProcessor: new SdkBase.BatchSpanProcessor(
      new OTLP.OTLPTraceExporter({
        url: `${base}/v1/traces`,
        headers,
      }),
    ),
  }))
}

export const layer = !base
  ? EffectLogger.layer
  : Layer.unwrap(
      Effect.gen(function* () {
        const trace = yield* Effect.promise(traces)
        return Layer.mergeAll(trace, logs)
      }),
    )

export const Observability = { enabled, layer }
