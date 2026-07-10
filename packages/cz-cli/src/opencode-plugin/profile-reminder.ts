import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin"

function syntheticPartID() {
  return `prt_${crypto.randomUUID()}`
}

export const ClickzettaProfileReminderPlugin: Plugin = async (_input: PluginInput): Promise<Hooks> => ({
  "experimental.chat.messages.transform": async (_input, output) => {
    const userMessage = [...output.messages].reverse().find((message) => message.info.role === "user")
    if (!userMessage) return

    const reminder = `<system-reminder>\nActive ClickZetta profile: ${process.env.CZ_PROFILE || "default"}\n</system-reminder>`
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
