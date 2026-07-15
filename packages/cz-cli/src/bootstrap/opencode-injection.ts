// Single entry point for every customization cz-cli injects into the pristine
// upstream opencode runtime. cz-1.17.11 keeps packages/opencode zero-cz-change; all
// behavior below is applied at runtime via environment variables (plus one global
// Worker shim). Centralized here so the full injection surface is reviewable in one
// place and easy to extend.
//
// ┌─ REGISTRY — everything we inject ───────────────────────────────────────────┐
// │ ENV VAR / MECHANISM              WHAT                          WHEN           │
// │ OPENCODE_DISABLE_AUTOUPDATE=1    kill upstream auto-updater    base (all cmds)│
// │ OPENCODE_DISABLE_PROJECT_CONFIG  ignore repo-local .opencode   base           │
// │ OPENCODE_OTLP_* / _SERVICE_NAME  telemetry defaults            base           │
// │ OPENCODE_CONFIG=<llm.json path>  cz LLM providers/model        agent runtime  │
// │ OPENCODE_CONFIG_CONTENT=<json>   providers/skills/plugins +    agent runtime  │
// │                                  data_engineer default agent                  │
// │ OPENCODE_TUI_CONFIG=<file>       cz home logo / brand plugin   agent runtime  │
// │ CLICKZETTA_AGENT_SYSTEM_PROMPT   cz-cli operational reference  agent runtime  │
// │ global Worker shim (not an env)  carry process.env into the    agent runtime  │
// │                                  TUI server Worker (Bun quirk)                │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// Two scopes, deliberately NOT merged:
//   applyBaseOpencodeEnv()        — every entry (CLI + agent). Must run first in
//                                   main() so flags land before opencode/the TUI
//                                   Worker reads them.
//   applyAgentRuntimeInjection()  — agent-runtime path ONLY (the `agent`/`run` TUI).
//                                   Depends on runtime-resolved values (llm.json
//                                   presence, --timeout) and must NOT burden plain
//                                   CLI commands (`cz-cli sql`, etc.) with agent config.
import fs from "node:fs"
import { applyDefaultOtelEnv } from "../otel-defaults.js"
import { CLICKZETTA_AGENT_SYSTEM_PROMPT } from "../agent-system-prompt.js"
import { llmConfigPath } from "../llm/native-config.js"
import { disableProjectConfigByDefault, disableUpstreamAutoupdate } from "./upstream-autoupdate.js"
import {
  injectClickzettaAgentConfig,
  injectClickzettaTuiConfig,
  installClickzettaWorkerEnvShim,
} from "./runtime-config.js"

// Base env applied on EVERY cz-cli invocation, at the very top of main(), before
// opencode or its TUI Worker reads any flag. Order preserved from the original
// runtime.main(): autoupdate → project-config → otel.
export function applyBaseOpencodeEnv(): void {
  disableUpstreamAutoupdate()
  disableProjectConfigByDefault()
  applyDefaultOtelEnv()
}

// Agent-runtime-only injection. Call from the agent branch AFTER the base env and
// after any llm.json migration/normalization has run. `agentTimeoutMs` comes from
// parseAgentTimeoutMs(args). Sets OPENCODE_CONFIG (llm.json), OPENCODE_CONFIG_CONTENT
// (providers/skills/plugins + data_engineer), OPENCODE_TUI_CONFIG (brand), the
// operational system prompt, then installs the Worker env shim LAST so it snapshots
// the fully-populated process.env into the TUI server Worker.
export function applyAgentRuntimeInjection(agentTimeoutMs?: number): void {
  const llmPath = llmConfigPath()
  if (fs.existsSync(llmPath) && !process.env.OPENCODE_CONFIG) {
    process.env.OPENCODE_CONFIG = llmPath
  }
  injectClickzettaAgentConfig(agentTimeoutMs)
  injectClickzettaTuiConfig()
  process.env.CLICKZETTA_AGENT_SYSTEM_PROMPT = CLICKZETTA_AGENT_SYSTEM_PROMPT
  installClickzettaWorkerEnvShim()
}
