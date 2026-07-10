/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { For } from "solid-js"

// cz_change: restore the ClickZetta "CZ-CLI" home logo through opencode's PUBLIC
// TUI plugin slot API (home_logo is a host slot declared mode:replace in
// packages/tui/src/routes/home.tsx). This plugin lives entirely in the cz layer
// and loads via tui.json's `plugin` array (see injectClickzettaTuiConfig in
// runtime-config.ts) — packages/opencode and packages/tui stay pristine, honoring
// the de-opencode invariant. The ASCII art matches the production cz-cli logo
// (origin/main packages/opencode/src/cli/cmd/tui/component/logo.tsx `FULL`).
const LOGO = [
  "  ██████╗ ███████╗        ██████╗ ██╗      ██╗",
  " ██╔════╝    ███╔╝       ██╔════╝ ██║      ██║",
  " ██║        ███╔╝  █████╗██║      ██║      ██║",
  " ██║       ███╔╝   ╚════╝██║      ██║      ██║",
  " ╚██████╗ ███████╗       ╚██████╗ ███████╗ ██║",
  "  ╚═════╝ ╚══════╝        ╚═════╝ ╚══════╝ ╚═╝",
]

const tui: TuiPlugin = async (api) => {
  const theme = () => api.theme.current
  api.slots.register({
    order: 100,
    slots: {
      home_logo() {
        return (
          <box flexDirection="column" flexShrink={0}>
            <For each={LOGO}>
              {(line) => (
                <text fg={theme().text} selectable={false}>
                  {line}
                </text>
              )}
            </For>
          </box>
        )
      },
    },
  })
}

const plugin: TuiPluginModule = { id: "clickzetta.tui-brand", tui }
export default plugin
