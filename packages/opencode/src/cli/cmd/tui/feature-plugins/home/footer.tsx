import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, Show } from "solid-js"
import { Global } from "@/global"
import { Brand } from "../../brand"

const id = "internal:home-footer"

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const dir = createMemo(() => {
    const dir = props.api.state.path.directory || process.cwd()
    const out = dir.replace(Global.Path.home, "~")
    const branch = props.api.state.vcs?.branch
    if (branch) return out + ":" + branch
    return out
  })
  const mcpList = createMemo(() => props.api.state.mcp())
  const mcpCount = createMemo(() => mcpList().filter((item) => item.status === "connected").length)

  return (
    <box
      width="100%"
      paddingTop={1}
      paddingLeft={2}
      paddingRight={2}
      flexDirection="row"
      flexShrink={0}
      gap={2}
    >
      <text fg={theme().textMuted}>{dir()}</text>
      <Show when={mcpCount() > 0}>
        <text fg={theme().textMuted}>
          <span style={{ fg: theme().success }}>•</span> {mcpCount()} MCP
        </text>
      </Show>
      <box flexGrow={1} />
      <text fg={theme().textMuted}>{Brand.name} v{props.api.app.version}</text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      home_footer() {
        return <View api={api} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
