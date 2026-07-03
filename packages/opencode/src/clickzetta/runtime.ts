/**
 * cz_change — ClickZetta runtime marker.
 *
 * Distinguishes "running as the cz agent" from "pure-upstream / test context".
 * Set once at the cz CLI entry (`main.ts`), it gates the cz prompt/message
 * plugins so they only mutate LLM requests when the cz agent is actually running
 * — upstream recorded-fixture tests (which never call the cz entry) see the
 * unmodified upstream behaviour.
 *
 * Backed by an env var so the signal propagates to TUI worker threads (env is
 * copied to workers). This is the gate for the always-registered internal cz
 * plugins (system-prompt / profile-reminder / skill-filter / outbound-headers).
 */
const RUNTIME_ENV = "CLICKZETTA_RUNTIME"

export function markClickzettaRuntime(): void {
  process.env[RUNTIME_ENV] = "1"
}

export function isClickzettaRuntime(): boolean {
  return process.env[RUNTIME_ENV] === "1"
}
