//======================== cz-cli change ========================
// Rebrand the TUI exit epilogue: "opencode" wordmark -> "CZ CLI", and the continue
// hint -> `cz-agent -s <id>`.
//
// The command was not merely off-brand, it was BROKEN: cz-cli isolates its global
// dirs (see UPSTREAM-PATCHES.md patches #1/#2), so `opencode -s <id>` cannot see a
// cz session and dies with "Session not found". Verified against a real install.
//
// Why intrusive (no hook exists) — all three alternatives were tried and measured
// against the shipped binary:
//   * there is NO epilogue slot in the TUI plugin slot map (packages/plugin/src/tui.ts),
//     and plugin slots render detached from the host Solid owner chain (every owner
//     had context === null), so `useEpilogue` is unreachable from a plugin;
//   * `@opencode-ai/tui/context/epilogue` is a package export, but it is not in the
//     runtime-plugin module map, so importing it from a plugin fails outright;
//   * a process.stdout.write filter installed from a plugin sees ZERO writes, because
//     plugin onDispose runs BEFORE app.tsx writes the epilogue. Installing the filter
//     in cz bootstrap does work, but it means pattern-matching ANSI-interleaved output
//     and re-emitting it — far more fragile than editing the source of truth, since it
//     would silently drop any row upstream later adds.
// Editing the two brand tokens here is the smallest and most durable change.
//
// The glyph data uses upstream's own markup (see marks in ../logo.ts: `_` = shadowed
// space, `^`/`~` = shadowed half-blocks), so the mark keeps upstream's shading and
// automatically follows any change to the draw() palette below.
// left = "CZ" (dim), right = "CLI" (bright) — mirroring upstream's own
// muted-then-bright split of "open" / "code".
const logo = {
  left: ["              ", "█▀▀▀ ▀▀▀█", "█    ▄▀^^", "▀▀▀▀ ▀▀▀▀"],
  right: ["              ", "█▀▀▀ █    ▀█▀", "█___ █__   █ ", "▀▀▀▀ ▀▀▀▀ ▀▀▀"],
}
//====================== end cz-cli change ======================

const reset = "\x1b[0m"
const bold = "\x1b[1m"
const dim = "\x1b[90m"

function wordmark(pad = "") {
  const draw = (line: string, fg: string, shadow: string, bg: string) =>
    [...line]
      .map((char) => {
        if (char === "_") return `${bg} ${reset}`
        if (char === "^") return `${fg}${bg}▀${reset}`
        if (char === "~") return `${shadow}▀${reset}`
        if (char === " ") return " "
        return `${fg}${char}${reset}`
      })
      .join("")

  return logo.left.map((line, index) => {
    const left = draw(line, dim, "\x1b[38;5;235m", "\x1b[48;5;235m")
    const right = draw(logo.right[index] ?? "", reset, "\x1b[38;5;238m", "\x1b[48;5;238m")
    return `${pad}${left} ${right}`
  })
}

export function sessionEpilogue(input: { title: string; sessionID?: string }) {
  const weak = (text: string) => `${dim}${text.padEnd(10, " ")}${reset}`
  return [
    ...wordmark("  "),
    "",
    `  ${weak("Session")}${bold}${input.title}${reset}`,
    //======================== cz-cli change ========================
    // `opencode -s <id>` -> `cz-agent -s <id>`; see the banner at the top of this file.
    `  ${weak("Continue")}${bold}cz-agent -s ${input.sessionID}${reset}`,
    //====================== end cz-cli change ======================
    "",
  ].join("\n")
}
