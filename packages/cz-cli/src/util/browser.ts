// cz_change: platform browser-opener command, extracted from commands/setup.ts so
// it can be reached without pulling that module in. setup.ts is ~1800 lines and
// imports @clack/prompts; the TUI gateway prompt needs this one pure function and
// gets pre-bundled, so importing setup.ts would drag an interactive-prompt
// dependency into a plugin bundle. setup.ts re-exports it for its own callers.

/** The shell command that hands a URL to the platform's default browser. */
export function browserOpenCommandForPlatform(platform: NodeJS.Platform, url: string): { command: string; args: string[] } {
  if (platform === "darwin") return { command: "open", args: [url] }
  if (platform === "win32") return { command: "cmd.exe", args: ["/c", "start", "", url] }
  return { command: "xdg-open", args: [url] }
}
