import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import PROMPT_CZ_CLI_INNER from "../../session/prompt/cz-cli-inner.txt"
import { isClickzettaRuntime } from "../runtime"

/**
 * cz_change — ClickZetta inner system prompt injection.
 *
 * On `main` this lived as a hard-coded `return [base, PROMPT_CZ_CLI_INNER]` in
 * `session/system.ts:36`. On v1.17.9 the same effect is achieved through the
 * real plugin hook `experimental.chat.system.transform`, so upstream `system.ts`
 * stays pure. The hook fires for every chat/agent system-prompt build
 * (`session/llm/request.ts:70`, `agent/agent.ts:379`), and we append the inner
 * prompt as an additional system entry — matching main's two-element shape.
 *
 * Registered as an internal plugin in `plugin/index.ts` (`internalPlugins`).
 * Gated on the cz runtime marker so it only injects when the cz agent actually
 * runs — pure-upstream / recorded-fixture tests (which never mark the runtime)
 * see the unmodified system prompt.
 */
export async function ClickzettaSystemPromptPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    "experimental.chat.system.transform": async (_input, output) => {
      if (!isClickzettaRuntime()) return
      if (output.system.includes(PROMPT_CZ_CLI_INNER)) return
      output.system.push(PROMPT_CZ_CLI_INNER)
    },
  }
}

