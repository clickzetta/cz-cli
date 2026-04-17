import { For } from "solid-js"
import { useTheme } from "@tui/context/theme"

type TipPart = { text: string; highlight: boolean }

function parse(tip: string): TipPart[] {
  const parts: TipPart[] = []
  const regex = /\{highlight\}(.*?)\{\/highlight\}/g
  const found = Array.from(tip.matchAll(regex))
  const state = found.reduce(
    (acc, match) => {
      const start = match.index ?? 0
      if (start > acc.index) {
        acc.parts.push({ text: tip.slice(acc.index, start), highlight: false })
      }
      acc.parts.push({ text: match[1], highlight: true })
      acc.index = start + match[0].length
      return acc
    },
    { parts, index: 0 },
  )

  if (state.index < tip.length) {
    parts.push({ text: tip.slice(state.index), highlight: false })
  }

  return parts
}

export function Tips() {
  const theme = useTheme().theme
  const parts = parse(TIPS[Math.floor(Math.random() * TIPS.length)])

  return (
    <box flexDirection="row" maxWidth="100%">
      <text flexShrink={0} style={{ fg: theme.textMuted }}>
        tip:{" "}
      </text>
      <text flexShrink={1}>
        <For each={parts}>
          {(part) => <span style={{ fg: part.highlight ? theme.text : theme.textMuted }}>{part.text}</span>}
        </For>
      </text>
    </box>
  )
}

const TIPS = [
  "Press {highlight}Tab{/highlight} to switch between Build and Plan agents",
  "Start with {highlight}!{/highlight} to run shell commands (e.g. {highlight}!ls -la{/highlight})",
  "Type {highlight}@{/highlight} to fuzzy search and attach files",
  "Press {highlight}Escape{/highlight} to stop the AI mid-response",
  "Use {highlight}/compact{/highlight} to summarize long sessions",
  "Press {highlight}Ctrl+P{/highlight} to see all commands",
  "Use {highlight}/undo{/highlight} to revert the last change",
  "Press {highlight}Ctrl+X E{/highlight} to compose in your editor",
  "Run {highlight}/init{/highlight} to generate project rules",
  "Use {highlight}/sessions{/highlight} to continue previous conversations",
]
