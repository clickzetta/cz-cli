# Upstream patch ledger (de-opencode invariant)

cz-cli is built as a ClickZetta customization layer on top of **pristine upstream
opencode** (currently baselined at v1.17.11). The guiding invariant is:

> **Keep `packages/opencode`, `packages/tui`, and `packages/core` pristine.**
> Put ClickZetta behavior in `packages/cz-cli/` and reach into upstream through
> the public hooks it exposes (plugin APIs, env flags, config injection).

The whole point is that a re-baseline onto a newer opencode is a clean
fast-forward of the upstream packages, with cz behavior riding on top.

## Why this file exists

Some behaviors **cannot** be expressed through an upstream hook — the only place
to change them is inside an upstream file. Those are *intrusive patches*. They are
the things a re-baseline will silently drop (upstream overwrites the file and the
cz edit is gone), exactly as happened during the 1.4.7 → 1.17.11 re-baseline.

This ledger is the **re-baseline checklist**: after every baseline bump, re-verify
every intrusive patch below still exists and still applies. Anything marked
`hook` is safe (lives in the cz layer); anything marked `INTRUSIVE` must be
manually re-applied and re-verified.

Intrusive edits are wrapped with a scannable banner so they can be found with grep:

```
//======================== cz-cli change ========================
... the edit, with rationale ...
//====================== end cz-cli change ======================
```

Find every intrusive patch:

```sh
rg -n "cz-cli change" packages/core packages/opencode packages/tui -g '!**/dist/**'
```

---

## INTRUSIVE patches (must survive/re-apply on every re-baseline)

### 1. Global directory namespace — product-identity isolation

- **File:** `packages/core/src/global.ts`
- **Marker:** `//===== cz-cli change =====` around `const app = "clickzetta"`
- **Upstream value:** `const app = "opencode"`
- **What/why:** `app` is opencode's on-disk product identity; it derives
  `~/.config/<app>`, `~/.local/share/<app>`, `~/.cache/<app>`, `~/.local/state/<app>`.
  Left as `"opencode"`, cz-agent shares all global dirs (config, **auth.json**,
  cache, state, worktrees, plans) with a real opencode install — editing one is
  seen by the other. Renaming to `"clickzetta"` isolates them.
- **Why intrusive (no hook):** paths are computed from a hardcoded top-level
  constant at module-import time. Upstream exposes only `OPENCODE_CONFIG_DIR`
  (config dir only, via `make()`); `data`/`cache`/`state`/`tmp` have no env
  override, and `OPENCODE_TEST_HOME` only affects the `home` getter. XDG env
  redirection was rejected — it leaks into every child process (LSP, git, user
  commands).
- **History:** applied on the 1.4.7 base (as `packages/opencode/src/global/index.ts`),
  **LOST** in the 1.17.11 re-baseline, re-applied.
- **No data migration:** old `~/.config/opencode` data is not moved; users
  re-authenticate under the clickzetta dirs (matches the 1.4.7 behavior).
- **Verify:** run cz, confirm dirs resolve under `.../clickzetta`, not `.../opencode`.

### 2. Home-level config dir — `~/.opencode` → `~/.clickzetta`

- **File:** `packages/opencode/src/config/paths.ts`
- **Marker:** `//===== cz-cli change =====` around `targets: [".clickzetta"]` in `directories()`.
- **Upstream value:** `targets: [".opencode"]`
- **What/why:** `directories()` reads a home-level config dir `~/.opencode`. This is
  a hardcoded literal that patch #1's `app = "clickzetta"` rename does NOT reach
  (that constant only governs the XDG config/data/cache/state roots). Left as
  `".opencode"`, a machine that also has a real opencode install shares
  `~/.opencode` with it — the user's opencode plugins/agents/commands leak into
  cz-cli and vice versa. Renaming the literal to `".clickzetta"` closes the one gap
  patch #1 can't.
- **Why intrusive (no hook):** this read is unconditional — no flag gates it and no
  env redirects its target (`OPENCODE_DISABLE_PROJECT_CONFIG` only gates the
  project-level read above it; `OPENCODE_CONFIG_DIR` only appends). Editing the
  literal is the only way.
- **Verify:** with `~/.clickzetta/plugin/foo.ts` present, confirm cz loads it and
  never reads `~/.opencode`.

### 3. TUI exit epilogue — brand + a BROKEN continue command

- **File:** `packages/tui/src/util/presentation.ts` (+ two upstream tests that assert
  the old string: `packages/tui/test/util/presentation.test.ts` and
  `packages/tui/test/app-lifecycle.test.tsx`)
- **Marker:** two `//===== cz-cli change =====` banners — one around the `logo` glyph
  data, one around the `Continue` line in `sessionEpilogue()`.
- **Upstream value:** an `opencode` wordmark, and `` `opencode -s ${sessionID}` ``.
- **What/why:** on exit the TUI prints a session epilogue (`Session <title>` /
  `Continue <cmd>`). Two problems: the wordmark is upstream brand, and the command is
  **wrong for cz users** — patches #1/#2 isolate cz's global dirs, so a real opencode
  install cannot see the session and answers `Session not found` (verified against a
  real install). It is a dead-end instruction, not just a cosmetic leak.
  Note this is a SECOND copy of the glyph data (`packages/tui/src/logo.ts` holds the
  one the home screen uses) — that duplication is why rebranding the home logo did
  not change this surface.
- **Why intrusive (no hook):** all three cz-layer routes were tried and measured
  against the shipped binary and all fail —
  1. there is no epilogue slot in `packages/plugin/src/tui.ts`'s `TuiHostSlotMap`, and
     plugin slots render detached from the host Solid owner chain (every owner had
     `context === null`), so `useEpilogue` is unreachable from a plugin;
  2. `@opencode-ai/tui/context/epilogue` is a package export but is NOT in the
     runtime-plugin module map, so importing it from a plugin throws
     `Cannot find module`;
  3. a `process.stdout.write` filter installed from a plugin sees ZERO writes — plugin
     `onDispose` runs BEFORE `app.tsx` writes the epilogue. Installing it in cz
     bootstrap does work, but it means matching ANSI-interleaved output and re-emitting
     it, which would silently swallow any row upstream later adds. Rejected as more
     fragile than editing the source of truth.
- **Glyph style:** the replacement uses upstream's OWN markup (`_`/`^`/`~` sentinels,
  see `packages/tui/src/logo.ts` `marks`), so it keeps upstream's shading and follows
  any change to the `draw()` palette.
- **Verify:** enter a session, exit, confirm the mark reads `CZ CLI` and the hint reads
  `cz-agent -s <id>`; then confirm that command actually resumes the session.

### 4. `/sql` prompt command

- **File:** `packages/tui/src/component/prompt/index.tsx`
- **Marker:** `//===== cz-cli change =====` around the import block, the `prompt.sql`
  palette entry, and the `onSubmit` dispatch branch.
- **cz files:** `packages/tui/src/component/prompt/sql-command.ts` (new, cz-owned —
  quoting/temp-file logic, unit-tested).
- **What/why:** adds `/sql <query>`, which runs the query through `session.shell` so the
  command and its output render as a tool part with **no LLM in the loop**. It must stay
  ABOVE the generic `/`-command branch: a config-declared command named `sql` would
  otherwise win dispatch and silently take the LLM path (`Command.execute` always ends
  in `prompt()`), which is a different feature.
- **Why intrusive (no hook):** prompt submission has no plugin interception point — the
  `home_prompt`/`session_prompt` slots replace the whole Prompt component rather than
  hooking its dispatch, so implementing this via slots would mean forking the entire
  prompt UI.
- **History:** written before this ledger entry existed and marked only with
  `cz_change:` comments, so `rg "cz-cli change"` did not find it — it was invisible to
  the re-baseline checklist. Banners added; no behavior change.
- **Verify:** `/sql show schemas` renders results as a tool part, with no LLM turn.

---

## HOOK-based customizations (safe — live entirely in the cz layer)

These do **not** edit upstream files. They are listed so a re-baseline can confirm
the hooks they depend on still exist in the new upstream.

### 1. Disable upstream opencode auto-updater (hard force)

- **cz files:** `packages/cz-cli/src/bootstrap/upstream-autoupdate.ts`,
  wired at the top of `main()` in `packages/cz-cli/src/bootstrap/runtime.ts`.
- **Mechanism:** unconditionally sets `process.env.OPENCODE_DISABLE_AUTOUPDATE = "1"`
  before the TUI's Bun Worker is constructed (carried into the Worker by
  `installClickzettaWorkerEnvShim`). Upstream `packages/opencode/src/cli/upgrade.ts`
  early-returns when `Flag.OPENCODE_DISABLE_AUTOUPDATE` is truthy.
- **Why:** the upstream updater points at opencode's GitHub releases / npm / brew
  and would overwrite the cz-cli install. cz-cli ships its own updater
  (`src/commands/update.ts`), gated by its own `autoupdate` config field — unaffected.
- **Upstream hook to re-verify on re-baseline:** `cli/upgrade.ts` still honors
  `OPENCODE_DISABLE_AUTOUPDATE`; the TUI still runs the server in a Worker whose
  env is snapshotted at construction.

### 2. Terminal window/tab title branding

- **cz files:** `packages/cz-cli/src/opencode-plugin/tui-title-brand.ts` (logic),
  imported by `packages/cz-cli/src/opencode-plugin/tui-brand.tsx` (the TUI plugin),
  both shipped as raw source by `packages/cz-cli/script/build.ts`.
- **Mechanism:** the TUI brand plugin (loaded via `OPENCODE_TUI_CONFIG`) wraps the
  shared `CliRenderer.setTerminalTitle` and rewrites upstream's `"OpenCode"` /
  `"OC | <title>"` to `"CZ CLI"` / `"CZ | <title>"`. Last-writer-wins, so it
  follows session/route changes with no reactive plumbing.
- **Upstream hook to re-verify on re-baseline:** TUI plugin API still exposes
  `api.renderer` (a `CliRenderer` with `setTerminalTitle`) and `api.lifecycle.onDispose`.
- **Catch-up write (do not remove):** wrapping alone was NOT enough and shipped broken —
  capturing OSC-0 escapes from the real binary showed the home title stuck at
  `OpenCode`. `app.tsx`'s title effect writes the home title during initial render,
  BEFORE TUI plugins load, and only re-runs on route/session change, so on the home
  screen the wrapper never sees a write. `installTerminalTitleBrand` therefore re-emits
  the branded title once at install time, guarded by upstream's own conditions
  (`terminal_title_enabled` kv + `OPENCODE_DISABLE_TERMINAL_TITLE`) so a user who
  disabled titles never gets one resurrected.

### 3. Home tips plugin disabled

- **cz files:** `packages/cz-cli/src/bootstrap/runtime-config.ts`
  (`CZ_TUI_PLUGIN_ENABLED`, written into the generated `tui.json`).
- **Mechanism:** `plugin_enabled` is a public TUI config field
  (`packages/plugin/src/tui.ts`) that opencode applies to INTERNAL builtins too, before
  activation (`plugin/tui/runtime.ts` `applyInitialPluginEnabledState`). We set
  `"internal:home-tips": false`.
- **Why:** the tip that actually renders for cz users is
  `Use /connect with OpenCode Zen for curated, tested models` — upstream brand plus a
  pitch for a service cz users cannot use; its sibling tips name `opencode` subcommands
  that do not exist in cz-cli. The `home_bottom` slot could NOT fix this (that slot is
  additive, not `mode:replace`), so config is the only clean lever.
- **Upstream hook to re-verify on re-baseline:** `plugin_enabled` still exists and still
  applies to `internal:*` ids; the tips builtin id is still `internal:home-tips`.

### 4. `--mini` removed from the cz TUI command

- **cz files:** `packages/cz-cli/src/agent-cmd/tui.ts` (wraps upstream
  `TuiThreadCommand`), registered in `bootstrap/runtime.ts` in place of the upstream one.
- **Mechanism:** re-declares `--mini`/`--no-replay`/`--replay-limit`/`--demo` as hidden
  and rejects them in the handler, delegating everything else to upstream verbatim.
- **Why:** `--mini` prints upstream splash art on BOTH entry and exit
  (`opencode/src/cli/cmd/run/splash.ts`), including a dead-end
  `opencode --mini -s <id>` hint. Unlike the epilogue, the splash is drawn cell-by-cell
  into renderables, so a text-level fix is impossible; branding it would mean a THIRD
  intrusive patch on a non-primary interface. Removing the flag was judged cheaper than
  carrying that debt. The full TUI (the default) is unaffected.
- **Upstream hook to re-verify on re-baseline:** `TuiThreadCommand` is still `$0` and
  still exposes `command`/`describe`/`builder`/`handler` we can wrap.

---

## Re-baseline procedure (quick)

1. Fast-forward upstream packages to the new opencode version.
2. `rg -n "cz-cli change" packages/core packages/opencode packages/tui` — expect the
   INTRUSIVE patches above. If any is missing, re-apply it from this ledger.
3. For each HOOK customization, confirm its "upstream hook to re-verify" still holds.
4. `cd packages/cz-cli && bun run typecheck && bun test`.
5. Update this file if the set of patches changed.
