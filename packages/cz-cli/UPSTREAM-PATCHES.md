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

### 5. Lazy flag reads — the precondition for ALL env-based injection

- **File:** `packages/core/src/flag/flag.ts`
- **Marker:** one `//===== cz-cli change =====` banner around the converted block.
- **Upstream value:** 26 of 34 entries were plain properties (`OPENCODE_CONFIG:
  process.env["OPENCODE_CONFIG"]`), i.e. a snapshot taken when the module is first
  imported; the other 8 were already getters.
- **What/why:** every cz customization reaches opencode by writing `process.env` from
  `bootstrap/opencode-injection.ts`, which runs inside `main()` — always AFTER
  opencode's module graph is loaded (`bootstrap/runtime.ts` statically imports an
  opencode module, and merely importing `run-cli.ts` pulls in the flag module). With an
  import-time snapshot, `Flag.OPENCODE_CONFIG` stayed `undefined` forever while
  `process.env.OPENCODE_CONFIG` held the real path, so opencode's config loader never
  read llm.json. Converting the env-backed entries to getters makes the reads lazy, so
  no caller needs to control import order.
- **Symptoms it fixed** (all one cause, all verified before/after on a built binary):
  `cz-cli agent llm models <entry>` → `MODEL_DISCOVERY_FAILED` for a healthy gateway
  entry; `agent llm models` listed zero llm.json providers; `agent run --model
  <entry>/<id>` → `Model not found`; `agent llm show` resolved its default model from a
  provider set with no llm.json entries. **The TUI was unaffected**, which is why this
  survived so long: its server runs in a Bun Worker whose fresh module registry
  re-evaluates flag.ts after the env is already set.
- **Why intrusive (no hook):** the value is captured inside upstream's own module
  initializer. No env var, flag, or plugin hook can influence it. The cz-side
  alternative — moving all injection into a module imported before anything else in
  every entry point — was rejected: it imposes permanent import-order discipline on two
  entry files to work around a defect one level down, and it only protects the vars cz
  happens to know about.
- **Not cz-specific:** opencode assigns `process.env.AWS_BEARER_TOKEN_BEDROCK` at
  runtime in `provider/provider.ts`, and upstream's own getter block carries the comment
  "Evaluated at access time (not module load) because tests, the CLI, and external
  tooling set these env vars at runtime". This patch finishes what that comment started,
  using upstream's existing pattern — so it is a good upstream PR candidate, after which
  this entry can be deleted.
- **Setters:** `OPENCODE_DB`, `OPENCODE_MODELS_PATH` and `OPENCODE_DISABLE_MODELS_FETCH`
  keep write access (writing through to `process.env`) because upstream tests assign to
  them as mutable slots (`core/test/plugin/models-dev.test.ts`,
  `sdk-next/test/embedded.test.ts`). Getter-only would have broken those tests.
- **Verify:** `packages/cz-cli/test/flag-injection-visibility.test.ts` imports the flag
  module first, then writes env, and asserts every injected var is observed — it goes
  RED if this patch is dropped. That test is the enforcement; this entry is only the
  explanation.

### 6. Opt-in error detail at the defect boundary

- **File:** `packages/opencode/src/server/routes/instance/httpapi/middleware/error.ts`
- **Marker:** one `//===== cz-cli change =====` banner around the `detail` block.
- **Upstream value:** the 500 body carries only
  `{ message: "Unexpected server error. Check server logs for details.", ref }`.
- **What/why:** that boundary swallows every defect. Correct for a server answering
  network clients, a dead end for `cz-cli mcp serve`, which starts a LOOPBACK opencode
  server in-process and relays its answers to the calling agent — so the agent got an
  opaque 500 for everything. A `ProviderModelNotFoundError` from a stale `config.model`
  was indistinguishable from a crash, and the only way to see the cause was correlating
  `ref` against the log file, which `Logger.toFile` writes on a batch window (the line
  is not on disk yet when the response goes out). With `OPENCODE_ERROR_DETAIL` set, the
  body also carries `data.detail = { error, cause }`.
- **Why intrusive (no hook):** the real error exists only inside this handler's
  `Cause`. There is no logger, layer or plugin seam cz can reach —
  `Server.listen()` is a non-Effect entry point that builds its own runtime, so cz
  cannot provide a Logger layer to it.
- **Blast radius:** nothing changes unless the flag is set. cz sets it in
  `runMcpServe` ONLY — deliberately not in `applyAgentRuntimeInjection`, because
  `cz-cli serve` binds a real port and internals must not leave the machine.
- **Verify:** `packages/cz-cli/test/mcp-error-format.test.ts` pins the rendering of both
  shapes (with and without `detail`). End to end:
  `CZ_MCP_ARGS='{"prompt":"hi"}' bun test/mcp-call-repro.ts` must name the real cause,
  not a bare ref.

### 7. ClickZetta dynamic model discovery in the provider loader

- **File:** `packages/opencode/src/provider/provider.ts`
- **Marker:** two `//===== cz-cli change =====` banners — one wrapping the discovery
  block inside the loader (`isClickzettaProvider` through the fallback seed loop),
  one wrapping the cz-owned helpers appended after `parseModel`
  (`clickzettaModelsUrl` through `buildClickzettaModel`, ending before the
  untouched `export const node = LayerNode.make(...)`).
- **What/why:** ClickZetta is a private gateway, so its models aren't in the
  models.dev catalog. Discovers them at runtime from the gateway's OpenAI-compatible
  `GET {baseURL}/v1/models`, matched on the provider's npm (the file:// specifier the
  cz layer rewrites every genuine ClickZetta entry to — see
  rewriteProviders/shouldRewriteProvider), not its URL. A provider left with zero
  models after discovery is seeded from `CLICKZETTA_FALLBACK_MODELS` rather than left
  empty.
- **Why intrusive (no hook):** discovery has to run inside the same loader pass that
  merges config providers and applies `isProviderAllowed`, mirroring the built-in
  gitlab discoverModels precedent; there is no plugin seam that runs before models
  are handed to the TUI.
- **History:** previously marked only with `cz_change:` comments (no banner, not in
  this ledger) — exactly the gap this ledger exists to catch, per entry 4's history
  note. Banner added; no behavior change.

### 8. Drop the cached global config on instance dispose

- **File:** `packages/opencode/src/server/routes/instance/httpapi/handlers/instance.ts`
- **Marker:** one `//===== cz-cli change =====` banner around the `cfg.invalidate()`
  call in `dispose`.
- **What/why:** the global config is cached with `Duration.infinity` on the
  PROCESS-level BootstrapRuntime (`config/config.ts` `cachedInvalidateWithTTL`), not
  on the instance, so disposing the instance alone left it in place and a rebuild
  observed the config as it was at startup. Callers that rewrite a config file and
  then dispose to pick it up (the TUI's provider-credential flows) silently got the
  stale providers.
- **Why intrusive (no hook):** the cache lives on the process-level runtime; nothing
  reachable from the cz layer can invalidate it except at this dispose call site.
- **History:** previously marked only with `cz_change:`, not in this ledger. Banner
  added; no behavior change.

### 9. Model-selection chain extracted for reuse by `cz-cli agent llm show`

- **File:** `packages/tui/src/context/local.tsx`
- **Marker:** two `//===== cz-cli change =====` banners — one around the
  `resolveModelSelection` import, one around the `fallbackModel` memo body.
- **cz files:** `packages/core/src/model-selection.ts` (new, cz-owned — the four-tier
  provider/model resolution chain, unit-tested).
- **What/why:** `cz-cli agent llm show` used to print "Default model: automatic
  (OpenCode selects at runtime)" whenever `config.model` was unset — wrong, since the
  chain's last tier is unconditional and always lands on one concrete model. The
  chain lived inline in `local.tsx`'s `fallbackModel` memo; extracted whole to
  `@opencode-ai/core/model-selection` so both callers run the same code instead of
  `show` guessing with a second copy of the rules. TUI behavior is unchanged — only
  the four inputs are now passed explicitly.
- **Why intrusive (no hook):** the chain reads TUI-only reactive state
  (`sync.data.config.model`, `modelStore.recent`, `sync.data.provider`,
  `sync.data.provider_default`); extracting it required changing the call site that
  reads that state, which lives in upstream's `local.tsx`.
- **History:** previously marked only with `cz_change:`, not in this ledger. Banners
  added; no behavior change.

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
