export * as ConfigOtel from "./otel"

import { czConfigBool, writeCzConfig } from "./cz-config.js"

/** Persisted preference only: bootstrap also sets the env var from defaults. */
export async function recordContent() {
  const configured = await czConfigBool("otel_record_content")
  if (configured !== undefined) return configured
  const { getTelemetry } = await import("../connection/profile-store.js")
  return getTelemetry()
}

export async function setRecordContent(enabled: boolean) {
  await writeCzConfig({ otel_record_content: enabled })
}
