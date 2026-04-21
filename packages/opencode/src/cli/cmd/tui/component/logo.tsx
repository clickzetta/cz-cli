import { createSignal, onCleanup, onMount } from "solid-js"
import { useTheme } from "@tui/context/theme"

const FULL = [
  "  ██████╗ ███████╗  ██████╗  ██████╗    ██████╗   ███████╗",
  " ██╔════╝    ███╔╝ ██╔════╝ ██╔═══██╗  ██╔═══██╗  ██╔════╝",
  " ██║        ███╔╝  ██║      ██║   ██║  ██║   ██║  █████╗  ",
  " ██║       ███╔╝   ██║      ██║   ██║  ██║   ██║  ██╔══╝  ",
  " ██║      ███╔╝    ██║      ██║   ██║  ██║   ██║  ██║     ",
  " ╚██████╗ ███████╗ ╚██████╗ ╚██████╔╝  ╚██████╔╝  ███████╗",
  "  ╚═════╝ ╚══════╝  ╚═════╝  ╚═════╝    ╚═════╝   ╚══════╝",
]

const WIDTH = FULL[0].length

function squeeze(lines: string[], ratio: number): string[] {
  if (ratio <= 0) return lines.map(() => "")
  if (ratio >= 1) return lines
  const target = Math.max(1, Math.round(WIDTH * ratio))
  return lines.map((line) => {
    const chars = [...line]
    const out: string[] = []
    for (let i = 0; i < target; i++) {
      const srcIdx = Math.round((i / target) * chars.length)
      out.push(chars[srcIdx] ?? " ")
    }
    const pad = Math.floor((WIDTH - target) / 2)
    return " ".repeat(pad) + out.join("") + " ".repeat(WIDTH - target - pad)
  })
}

const KEYFRAMES = [
  1, 0.95, 0.85, 0.7, 0.5, 0.3, 0.15, 0.05,
  0.05, 0.15, 0.3, 0.5, 0.7, 0.85, 0.95, 1,
]

const FRAME_MS = 50
const PAUSE_MS = 4000

export function Logo() {
  const { theme } = useTheme()
  const [lines, setLines] = createSignal(FULL)
  let frame = 0
  let spinning = false
  let timer: ReturnType<typeof setTimeout> | undefined

  function tick() {
    if (!spinning) return
    setLines(squeeze(FULL, KEYFRAMES[frame]))
    frame++
    if (frame >= KEYFRAMES.length) {
      spinning = false
      frame = 0
      setLines(FULL)
      timer = setTimeout(spin, PAUSE_MS)
      return
    }
    timer = setTimeout(tick, FRAME_MS)
  }

  function spin() {
    spinning = true
    frame = 0
    tick()
  }

  onMount(() => {
    timer = setTimeout(spin, PAUSE_MS)
  })

  onCleanup(() => {
    if (timer) clearTimeout(timer)
  })

  return (
    <box>
      {lines().map((line) => (
        <text fg={theme.primary}>{line}</text>
      ))}
    </box>
  )
}
