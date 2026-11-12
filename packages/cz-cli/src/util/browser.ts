// cz_change: platform browser-opener command, extracted from commands/setup.ts so
// it can be reached without pulling that module in. setup.ts is ~1800 lines and
// imports @clack/prompts; the TUI gateway prompt needs this one pure function and
// gets pre-bundled, so importing setup.ts would drag an interactive-prompt
// dependency into a plugin bundle. setup.ts re-exports it for its own callers.

/**
 * The command that hands a URL to the platform's default browser.
 *
 * Every variant takes the URL as a plain argv entry that no shell parses. Windows
 * used to go through `cmd.exe /c start "" <url>`, where cmd treats `&` as a
 * command separator: a URL with a second query parameter was cut at the `&` and
 * the remainder run as a command. `url.dll,FileProtocolHandler` receives the URL
 * verbatim and opens it with the registered handler, without a console window.
 */
export function browserOpenCommandForPlatform(platform: NodeJS.Platform, url: string): { command: string; args: string[] } {
  if (platform === "darwin") return { command: "open", args: [url] }
  if (platform === "win32") return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] }
  return { command: "xdg-open", args: [url] }
}

/**
 * Can a browser opened from this process reach the person at the keyboard?
 *
 * False over SSH even when the remote host has a desktop: `open`/`xdg-open` would
 * launch a browser on the remote machine's screen, out of the user's sight, and the
 * spawn still "succeeds", so the failure cannot be detected after the fact. On
 * Linux and the BSDs a browser also needs a display server. macOS and Windows
 * always have one for a local session.
 */
export function canOpenBrowser(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) return false
  if (platform === "darwin" || platform === "win32") return true
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY)
}
