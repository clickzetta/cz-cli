import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createEffect, createMemo, createSignal } from "solid-js"
import { Logo } from "../component/logo"
import { useProject } from "../context/project"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useRouteData } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { useLocal } from "../context/local"
import { useTheme } from "../context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import { TuiPluginRuntime } from "../plugin"
import { Brand } from "../brand"

let once = false
const placeholder = {
  normal: ["ask a question or describe a task"],
  shell: ["ls -la", "git status", "pwd"],
}

export function Home() {
  const sync = useSync()
  const project = useProject()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const [ref, setRef] = createSignal<PromptRef | undefined>()
  const args = useArgs()
  const local = useLocal()
  const { theme } = useTheme()
  const dims = useTerminalDimensions()
  let sent = false

  const separator = createMemo(() => "─".repeat(dims().width - 4))
  const dir = createMemo(() => {
    const d = project.instance.directory() || process.cwd()
    const home = process.env.HOME || ""
    return home && d.startsWith(home) ? "~" + d.slice(home.length) : d
  })

  const bind = (r: PromptRef | undefined) => {
    setRef(r)
    promptRef.set(r)
    if (once || !r) return
    if (route.initialPrompt) {
      r.set(route.initialPrompt)
      once = true
      return
    }
    if (!args.prompt) return
    r.set({ input: args.prompt, parts: [] })
    once = true
  }

  createEffect(() => {
    const r = ref()
    if (sent) return
    if (!r) return
    if (!sync.ready || !local.model.ready) return
    if (!args.prompt) return
    if (r.current.input !== args.prompt) return
    sent = true
    r.submit()
  })

  return (
    <>
      <box flexGrow={1} paddingLeft={2} paddingRight={2}>
        {/* Banner with rotation animation */}
        <box paddingTop={1}>
          <Logo />
          <text fg={theme.textMuted}>{Brand.company} Lakehouse AI</text>
        </box>

        {/* Separator with spacing */}
        <box paddingTop={1} paddingBottom={1}>
          <text fg={theme.border}>{separator()}</text>
        </box>

        {/* Spacer */}
        <box flexGrow={1} minHeight={0} />

        {/* Prompt context line */}
        <box paddingBottom={1}>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.primary, bold: true }}>{Brand.display}</span> · auto {dir()}
          </text>
        </box>

        {/* Prompt */}
        <box width="100%" zIndex={1000} flexShrink={0}>
          <TuiPluginRuntime.Slot
            name="home_prompt"
            mode="replace"
            workspace_id={project.workspace.current()}
            ref={bind}
          >
            <Prompt
              ref={bind}
              workspaceID={project.workspace.current()}
              right={<TuiPluginRuntime.Slot name="home_prompt_right" workspace_id={project.workspace.current()} />}
              placeholders={placeholder}
            />
          </TuiPluginRuntime.Slot>
        </box>
        <TuiPluginRuntime.Slot name="home_bottom" />
        <Toast />
      </box>
    </>
  )
}
