import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin"

export const ClickzettaSystemPromptPlugin: Plugin = async (_input: PluginInput): Promise<Hooks> => ({
  "experimental.chat.system.transform": async (_input, output) => {
    const prompt = process.env.CLICKZETTA_AGENT_SYSTEM_PROMPT
    if (!prompt) return
    if (output.system.includes(prompt)) return
    output.system.push(prompt)
  },
})
