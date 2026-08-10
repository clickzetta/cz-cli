/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, For } from "solid-js"
import {
  installTerminalTitleBrand,
  czFooterPath,
  CZ_BRAND_LEAD,
  CZ_BRAND_TAIL,
} from "./tui-title-brand"
import { installQuotaIndicator } from "./tui-quota"
import { installGatewayPrompt } from "./gateway-prompt-view"
import { createActiveModelContext } from "./tui-quota-runtime.js"

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

// cz_change: replacement for upstream's sidebar_footer builtin, whose brand line
// reads "• OpenCode <version>" (packages/tui/src/feature-plugins/sidebar/footer.tsx).
// Keeps upstream's shape — directory line, then the brand + version — and drops
// only upstream's "Getting started" panel, which advertises opencode's free models
// and /connect flow. That panel is unreachable here anyway: it shows only when no
// provider outside the built-in `opencode` one exists, and cz disables that provider
// (disabled_providers in injectClickzettaAgentConfig) while always supplying
// ClickZetta providers.
function SidebarFooter(props: { api: TuiPluginApi; sessionID: string }) {
  const theme = () => props.api.theme.current
  const path = createMemo(() => {
    const session = props.api.state.session.get(props.sessionID)
    const directory = session?.directory || props.api.state.path.directory || process.cwd()
    // Only show the branch when the session runs in the TUI's own directory —
    // state.vcs describes that directory, not an arbitrary session's.
    const branch =
      session?.directory === props.api.state.path.directory ? props.api.state.vcs?.branch : undefined
    return czFooterPath({ directory, branch })
  })

  return (
    <box gap={1}>
      <text>
        <span style={{ fg: theme().textMuted }}>{path().parent}/</span>
        <span style={{ fg: theme().text }}>{path().name}</span>
      </text>
      <text fg={theme().textMuted}>
        <span style={{ fg: theme().primary }}>•</span> <b>{CZ_BRAND_LEAD}</b>{" "}
        <span style={{ fg: theme().text }}>
          <b>{CZ_BRAND_TAIL}</b>
        </span>{" "}
        <span>{props.api.app.version}</span>
      </text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  installTerminalTitleBrand(api)
  // cz_change: ONE active provider/model context for the whole TUI, created here
  // and handed to every consumer. Both features below act on "the provider serving
  // this session" — measuring its quota, replacing its exhausted key — so they must
  // agree; two independent answers is precisely the bug that swapped a new key into
  // the wrong llm.json entry. See active-model.ts.
  const activeModel = createActiveModelContext(api)
  api.lifecycle.onDispose(() => activeModel.dispose())
  // cz_change: the balance/quota indicator rides along in this plugin rather than
  // as a second tui.json entry — one plugin spec keeps injectClickzettaTuiConfig
  // and the build's asset list unchanged in shape. See tui-quota.tsx.
  installQuotaIndicator(api, activeModel)
  // cz_change: same rationale — one plugin spec. Offers a browser jump when the
  // gateway blocks a call for billing / key-quota reasons. See gateway-prompt.ts.
  installGatewayPrompt(api, activeModel)
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
  // cz_change: sidebar_footer is declared mode="single_winner"
  // (packages/tui/src/routes/session/sidebar.tsx), so unlike home_logo this slot
  // already HAS an occupant: upstream's own internal:sidebar-footer builtin. The
  // winner is the lowest `order`, ties broken by registration order — and internal
  // plugins register before external ones (internalTuiPlugins runs first in
  // packages/opencode/src/plugin/tui/runtime.ts), so matching the builtin's order
  // of 100 would lose. A separate register call with a lower order is what claims
  // the slot; it also keeps home_logo's order untouched.
  api.slots.register({
    order: 0,
    slots: {
      sidebar_footer(_ctx, props) {
        return <SidebarFooter api={api} sessionID={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule = { id: "clickzetta.tui-brand", tui }
export default plugin
