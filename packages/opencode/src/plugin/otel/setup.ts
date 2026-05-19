import { metrics, trace } from "@opentelemetry/api"
import { logs } from "@opentelemetry/api-logs"
import type { Logger } from "@opentelemetry/api-logs"
import { resourceFromAttributes } from "@opentelemetry/resources"
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http"
import { LoggerProvider, BatchLogRecordProcessor } from "@opentelemetry/sdk-logs"
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http"
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics"
import { BasicTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-base"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import type { LoggerProvider as LoggerProviderType } from "@opentelemetry/sdk-logs"
import type { MeterProvider as MeterProviderType } from "@opentelemetry/sdk-metrics"
import type { BasicTracerProvider as BasicTracerProviderType } from "@opentelemetry/sdk-trace-base"

export interface OtelSdk {
  logger: Logger
  tracerProvider: BasicTracerProviderType
  loggerProvider: LoggerProviderType
  meterProvider: MeterProviderType
  shutdown(): Promise<void>
}

export async function initOtelSdk(
  endpoint: string,
  headers: Record<string, string>,
  resourceAttrs: Record<string, string>,
): Promise<OtelSdk> {
  const resource = resourceFromAttributes(resourceAttrs)

  const logExporter = new OTLPLogExporter({ url: `${endpoint}/v1/logs`, headers })
  const loggerProvider = new LoggerProvider({ resource, processors: [new BatchLogRecordProcessor(logExporter)] })
  logs.setGlobalLoggerProvider(loggerProvider)
  const logger = loggerProvider.getLogger("opencode")

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
    logger,
    tracerProvider,
    loggerProvider,
    meterProvider,
    async shutdown() {
      await Promise.allSettled([loggerProvider.shutdown(), tracerProvider.shutdown(), meterProvider.shutdown()])
    },
  }
}
