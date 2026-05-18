import { metrics, trace } from "@opentelemetry/api"
import type { LoggerProvider } from "@opentelemetry/sdk-logs"
import type { MeterProvider } from "@opentelemetry/sdk-metrics"
import type { BasicTracerProvider } from "@opentelemetry/sdk-trace-base"

export interface OtelSdk {
  tracerProvider: BasicTracerProvider
  loggerProvider: LoggerProvider
  meterProvider: MeterProvider
  shutdown(): Promise<void>
}

export async function initOtelSdk(
  endpoint: string,
  headers: Record<string, string>,
  resourceAttrs: Record<string, string>,
): Promise<OtelSdk> {
  const { resourceFromAttributes } = await import("@opentelemetry/resources")
  const { OTLPLogExporter } = await import("@opentelemetry/exporter-logs-otlp-http")
  const { LoggerProvider, BatchLogRecordProcessor } = await import("@opentelemetry/sdk-logs")
  const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-http")
  const { MeterProvider, PeriodicExportingMetricReader } = await import("@opentelemetry/sdk-metrics")
  const { BasicTracerProvider, BatchSpanProcessor } = await import("@opentelemetry/sdk-trace-base")
  const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http")
  const logsApi = await import("@opentelemetry/api-logs")

  const resource = resourceFromAttributes(resourceAttrs)

  const logExporter = new OTLPLogExporter({ url: `${endpoint}/v1/logs`, headers })
  const loggerProvider = new LoggerProvider({ resource, processors: [new BatchLogRecordProcessor(logExporter)] })
  logsApi.logs.setGlobalLoggerProvider(loggerProvider)

  const traceExporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces`, headers })
  const tracerProvider = new BasicTracerProvider({ resource, spanProcessors: [new BatchSpanProcessor(traceExporter)] })
  trace.setGlobalTracerProvider(tracerProvider)

  const metricExporter = new OTLPMetricExporter({ url: `${endpoint}/v1/metrics`, headers })
  const meterProvider = new MeterProvider({
    resource,
    readers: [new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 30_000 })],
  })
  metrics.setGlobalMeterProvider(meterProvider)

  return {
    tracerProvider,
    loggerProvider,
    meterProvider,
    async shutdown() {
      await Promise.allSettled([loggerProvider.shutdown(), tracerProvider.shutdown(), meterProvider.shutdown()])
    },
  }
}
