import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { resolveCurrentProfileLabel } from "@/config/profiles-llm"
import { PartID } from "@/session/schema"
import { isClickzettaRuntime } from "../runtime"

/**
 * cz_change — active ClickZetta profile reminder.
 *
 * On `main`, `session/prompt.ts` `insertReminders` pushed a synthetic
 * `<system-reminder>Active ClickZetta profile: …` text part onto the last user
 * message every turn (prompt.ts:236). v1.17.9 moved reminder handling into the
 * upstream `SessionReminders` module, so rather than re-weave prompt.ts we use
 * the real `experimental.chat.messages.transform` hook (fired at
 * prompt.ts:1307) and append the reminder there — upstream prompt.ts stays pure.
 *
 * The label resolves from `CZ_PROFILE` env / `profiles.toml` default_profile
 * (resolveCurrentProfileLabel). Pure-upstream builds never register this plugin.
 *
 * Note: main's PLAN_MODE-gated plan/build reminders (PROMPT_PLAN / BUILD_SWITCH)
 * are NOT re-added here — v1.17.9's SessionReminders owns plan-mode reminders
 * natively, so only the ClickZetta-specific profile label is the cz delta.
 */
export async function ClickzettaProfileReminderPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      if (!isClickzettaRuntime()) return
      const userMessage = [...output.messages].reverse().find((m) => m.info.role === "user")
      if (!userMessage) return

      const reminder = `<system-reminder>\nActive ClickZetta profile: ${resolveCurrentProfileLabel()}\n</system-reminder>`
      // Idempotency guard: don't stack reminders if the hook runs twice.
      if (userMessage.parts.some((p) => p.type === "text" && p.text === reminder)) return

      userMessage.parts.push({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: reminder,
        synthetic: true,
      } as (typeof userMessage.parts)[number])
    },
  }
}
