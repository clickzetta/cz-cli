import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin"
import * as Profile from "../connection/profile-context.js"

function syntheticPartID() {
  return `prt_${crypto.randomUUID()}`
}

export const ClickzettaProfileReminderPlugin: Plugin = async (_input: PluginInput): Promise<Hooks> => ({
  "experimental.chat.messages.transform": async (_input, output) => {
    const userMessage = [...output.messages].reverse().find((message) => message.info.role === "user")
    if (!userMessage) return

    // Report the profile the tools will actually use — including the
    // default_profile fallback, which Profile.current() resolves. Reading
    // CZ_PROFILE alone printed the literal word "default" whenever no --profile was
    // passed, telling the model a profile name that generally does not exist.
    const reminder = `<system-reminder>\nActive ClickZetta profile: ${Profile.current() ?? "none configured"}\n</system-reminder>`
    if (userMessage.parts.some((part) => part.type === "text" && part.text === reminder)) return

    userMessage.parts.push({
      id: syntheticPartID(),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text: reminder,
      synthetic: true,
    } as (typeof userMessage.parts)[number])
  },
})
