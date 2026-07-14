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

---

## HOOK-based customizations (safe — live entirely in the cz layer)

These do **not** edit upstream files. They are listed so a re-baseline can confirm
the hooks they depend on still exist in the new upstream.

### 2. Disable upstream opencode auto-updater (hard force)

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

### 3. Terminal window/tab title branding

- **cz files:** `packages/cz-cli/src/opencode-plugin/tui-title-brand.ts` (logic),
  imported by `packages/cz-cli/src/opencode-plugin/tui-brand.tsx` (the TUI plugin),
  both shipped as raw source by `packages/cz-cli/script/build.ts`.
- **Mechanism:** the TUI brand plugin (loaded via `OPENCODE_TUI_CONFIG`) wraps the
  shared `CliRenderer.setTerminalTitle` and rewrites upstream's `"OpenCode"` /
  `"OC | <title>"` to `"CZ CLI"` / `"CZ | <title>"`. Last-writer-wins, so it
  follows session/route changes with no reactive plumbing.
- **Upstream hook to re-verify on re-baseline:** TUI plugin API still exposes
  `api.renderer` (a `CliRenderer` with `setTerminalTitle`) and `api.lifecycle.onDispose`.

---

## Re-baseline procedure (quick)

1. Fast-forward upstream packages to the new opencode version.
2. `rg -n "cz-cli change" packages/core packages/opencode packages/tui` — expect the
   INTRUSIVE patches above. If any is missing, re-apply it from this ledger.
3. For each HOOK customization, confirm its "upstream hook to re-verify" still holds.
4. `cd packages/cz-cli && bun run typecheck && bun test`.
5. Update this file if the set of patches changed.
