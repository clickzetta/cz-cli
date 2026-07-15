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

// cz_change: cz-cli is a single-user tool whose config lives under the user's
// home (~/.config/clickzetta, ~/.clickzetta), NOT in whatever repo the user
// happens to `cd` into. Upstream opencode, by default, also discovers
// project-level config — <cwd>/opencode.json[c] and <cwd>/.opencode/ walked up to
// the worktree root (packages/opencode/src/config/config.ts:405 and
// config/paths.ts:27, both gated by Flag.OPENCODE_DISABLE_PROJECT_CONFIG). For cz
// that is surprising: a stray .opencode in some cloned repo would silently alter
// the agent's config/agents/plugins. We turn project discovery OFF by default.
//
// This is a pure env hook (no edit to packages/opencode|core|tui): the flag is
// `truthy("OPENCODE_DISABLE_PROJECT_CONFIG")` in packages/core/src/flag/flag.ts.
// Set in process.env before opencode reads it (and carried into the TUI Worker by
// installClickzettaWorkerEnvShim), exactly like disableUpstreamAutoupdate.
//
// Unlike autoupdate, project config is not "always harmful" — a user or CI that
// genuinely wants repo-local config can still re-enable it by exporting
// OPENCODE_DISABLE_PROJECT_CONFIG=0 (or any non-truthy value). We only supply the
// default when the user has expressed no preference.
export function disableProjectConfigByDefault(): void {
  if (process.env.OPENCODE_DISABLE_PROJECT_CONFIG === undefined) {
    process.env.OPENCODE_DISABLE_PROJECT_CONFIG = "1"
  }
}
