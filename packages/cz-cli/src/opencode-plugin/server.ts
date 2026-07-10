import type { Hooks, Plugin, PluginInput, PluginOptions } from "@opencode-ai/plugin"
import { ClickzettaOutboundHeadersPlugin } from "./outbound-headers.js"
import { OtelPlugin } from "./otel/index.js"
import { ClickzettaProfileReminderPlugin } from "./profile-reminder.js"
import { ClickzettaSystemPromptPlugin } from "./system-prompt.js"

const PLUGINS = [
  ClickzettaSystemPromptPlugin,
  ClickzettaProfileReminderPlugin,
  ClickzettaOutboundHeadersPlugin,
  OtelPlugin,
] satisfies Plugin[]

function runHook<T extends unknown[]>(
  hooks: Hooks[],
  name: keyof Hooks,
) {
  const active = hooks
    .map((hook) => hook[name])
    .filter((hook): hook is (...args: T) => Promise<void> => typeof hook === "function")

  if (active.length === 0) return

  return async (...args: T) => {
    for (const hook of active) await hook(...args)
  }
}

function mergeHooks(hooks: Hooks[]): Hooks {
  return {
    dispose: runHook(hooks, "dispose"),
    event: runHook(hooks, "event"),
    config: runHook(hooks, "config"),
    "chat.headers": runHook(hooks, "chat.headers"),
    "shell.env": runHook(hooks, "shell.env"),
    "experimental.chat.messages.transform": runHook(hooks, "experimental.chat.messages.transform"),
    "experimental.chat.system.transform": runHook(hooks, "experimental.chat.system.transform"),
  }
}

async function server(input: PluginInput, options?: PluginOptions) {
  return mergeHooks(await Promise.all(PLUGINS.map((plugin) => plugin(input, options))))
}

export default {
  id: "@clickzetta/cz-cli-agent",
  server,
}
