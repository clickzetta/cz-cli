import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { isClickzettaRuntime } from "../runtime"

/**
 * cz_change — exclude the `cz-cli` skill from loading.
 *
 * The agent already invokes `cz-cli` directly via the bash tool; loading a
 * `cz-cli` skill would invite recursive `cz-cli agent run` self-invocation.
 * Implemented via opencode's native `skill.filter` hook (added upstream-style),
 * so `skill/index.ts` carries no ClickZetta literal.
 *
 * Gated on the cz runtime marker; pure-upstream builds exclude nothing.
 */
const EXCLUDED_SKILLS = new Set(["cz-cli"])

export async function ClickzettaSkillFilterPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    "skill.filter": async (input, output) => {
      if (!isClickzettaRuntime()) return
      if (EXCLUDED_SKILLS.has(input.name)) output.exclude = true
    },
  }
}
