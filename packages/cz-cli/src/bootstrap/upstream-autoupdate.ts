// cz_change: Hard-disable the UPSTREAM opencode auto-updater so it never runs in
// cz-cli. cz-cli ships its own updater (src/commands/update.ts); the upstream one
// points at opencode's GitHub releases + npm/brew, uses the wrong branding, and can
// overwrite the cz-cli install.
//
// Trigger chain we neutralize: opencode's TUI calls `checkUpgrade` ~1s after start
// (opencode/src/cli/cmd/tui.ts) → tui worker `await upgrade()` (cli/tui/worker.ts) →
// cli/upgrade.ts, which early-returns when `Flag.OPENCODE_DISABLE_AUTOUPDATE` is
// truthy. That flag is `truthy("OPENCODE_DISABLE_AUTOUPDATE")` in
// packages/core/src/flag/flag.ts (env value lowercased === "true" || "1"). Setting
// the env var before opencode reads the flag disables the updater WITHOUT editing
// packages/opencode|tui|core (the de-opencode invariant).
//
// Timing: this must run before the TUI's server Worker is constructed. The TUI runs
// opencode in a Bun Worker, and Bun snapshots a Worker's env at process start unless
// an explicit `{ env }` is passed. installClickzettaWorkerEnvShim() already defaults
// that env to the current process.env, so as long as the flag is in process.env of
// the main process before the Worker is built, it propagates into the Worker. Both
// entry flows converge on runtime.ts main() (compiled: boot.ts → main; dev: main.ts →
// run-cli → delegateToAgentRuntime → main), which is where the TUI/Worker is created,
// so calling this at the top of main() covers both flows.
//
// Hard-force ON regardless of any pre-existing value. Unlike env-shim's "explicit
// OPENCODE_* wins" convention, we do NOT honor a user-set OPENCODE_DISABLE_AUTOUPDATE=0
// here: the upstream updater has no correct use for a cz user (it fetches opencode's
// GitHub releases and would `npm install -g opencode-ai` over the cz-cli install), so
// a value that re-enables it is only ever an accident or a stray env from CI. We
// unconditionally pin it off. cz-cli's own updater (src/commands/update.ts) is unaffected.
export function disableUpstreamAutoupdate(): void {
  process.env.OPENCODE_DISABLE_AUTOUPDATE = "1"
}
