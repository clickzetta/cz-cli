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
- **Marker:** two `//===== cz-cli change =====` banners — one around the `Flag`
  import, one around the `detail` block.
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
- **Upstream value:** no discovery block in the loader at all, and no
  `clickzetta*` helpers after `parseModel` — a provider's model list comes
  entirely from the models.dev catalog, with nothing filled in for a private
  gateway.
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
- **Verify:** `packages/opencode/test/provider/clickzetta-discovery.test.ts` and
  `clickzetta-context-limit.test.ts` cover discovery and the context-window table;
  both must stay green after a re-baseline.

### 8. Drop the cached global config on instance dispose

- **File:** `packages/opencode/src/server/routes/instance/httpapi/handlers/instance.ts`
- **Marker:** one `//===== cz-cli change =====` banner around the `cfg.invalidate()`
  call in `dispose`.
- **Upstream value:** `dispose` has no `cfg.invalidate()` call — it disposes the
  instance's own resources only, and the process-level config cache is
  untouched.
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
- **Verify:** rewrite a global config file, dispose the instance, confirm the
  rebuilt instance's provider list reflects the rewrite rather than the one
  observed at startup.

### 9. Model-selection chain extracted for reuse by `cz-cli agent llm show`

- **File:** `packages/tui/src/context/local.tsx`
- **Marker:** two `//===== cz-cli change =====` banners — one around the
  `resolveModelSelection` import, one around the `fallbackModel` memo body.
- **Upstream value:** the four-tier chain is inlined directly in `local.tsx`'s
  `fallbackModel` memo; there is no import of `@opencode-ai/core/model-selection`
  and no shared implementation for a second caller to reuse.
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
- **Verify:** `packages/core/test/model-selection.test.ts` covers the four-tier
  precedence directly; goes RED if `resolveModelSelection`'s tier order or
  fallback-on-dead-ref behavior regresses. Manually: `cz-cli agent llm show`
  names a concrete provider/model with `config.model` unset (never "automatic").

---

### 10. Repository README — product identity of the landing page

- **Files:** `README.md` (replaced), `README.{ar,bn,br,bs,da,de,es,fr,gr,it,ja,ko,no,pl,ru,th,tr,uk,vi,zh,zht}.md` (deleted)
- **Upstream value:** opencode's README plus 21 translations, all describing
  "The open source AI coding agent" and linking to opencode.ai.
- **What/why:** this repository IS the cz-cli product repo — its landing page and the
  `clickzetta/cz-cli` install instructions are what a user arrives at. Upstream's README
  documents a different product, and its language-nav links pointed at the 21
  translations, which describe that product too, so they go with it. The cz README is
  restored from the pre-re-baseline lineage (commit `0127bc4358`) and rewritten against
  the current command surface — the old copy predated `auth`/`login`, the `--format` /
  `--field` contract, `mcp init`, `ai-gateway`, `analytics-agent` and `dqc`, and still
  documented `cz-cli setup` (now deprecated) and a `--format a2a` that no longer exists.
- **Why intrusive (no hook):** a repository has exactly one root README; there is no
  mechanism for overriding it from a package.
- **Re-baseline:** upstream's README returns as a conflict on this path. Keep ours;
  re-delete any translations the new baseline adds. Nothing in the build or the release
  workflow reads either file.

### 11. Upstream CI workflows removed — they cost minutes and act on this repo

- **Files:** 25 deleted under `.github/workflows/`: `beta`, `build-vscode-extension`,
  `close-issues`, `close-prs`, `compliance-close`, `containers`, `deploy`,
  `docs-locale-sync`, `docs-update`, `duplicate-issues`, `generate`, `nix-eval`,
  `nix-hashes`, `notify-discord`, `opencode`, `publish`, `publish-github-action`,
  `publish-vscode`, `release-github-action`, `review`, `stats`, `storybook`, `test`,
  `triage`, `typecheck`.
- **Kept:** `cz-test.yml`, `claude-review.yml`, `release-cos.yml` — the three cz-owned
  workflows. `script/github/*.ts` and the other upstream scripts are left in place;
  they are inert without a workflow to call them.
- **What/why:** measured over 30 days, the deleted set ran 728 times against 101 for the
  cz-owned three. `compliance-close` (387 runs, every 30 min) and `beta` (245 runs,
  hourly) are upstream community/publish machinery with no repo guard. Two of them acted
  on this repository's data rather than merely wasting a runner: `close-prs` scans all
  1331 open PRs daily and closes any older than one month with fewer than two positive
  reactions — including ours — and `close-issues` does the same for issues. The publish /
  release / docs / nix / storybook / vscode-marketplace workflows target upstream's
  artifacts and secrets. `test` and `typecheck` request `blacksmith-*` runners that do
  not exist in this fork, so their jobs queue for 24h and then fail, which is where the
  permanently-pending `unit (linux)` / `e2e (windows)` checks on cz PRs came from;
  `cz-test.yml` is the replacement that actually runs.
- **Why intrusive (no hook):** workflow files are read from the repository by GitHub;
  there is no configuration that disables one from outside the file.
- **Precedent:** `b40281f02e` already removed `pr-management.yml` and `pr-standards.yml`
  for the same reason (they failed on a `dev` ref this fork does not have).
- **Re-baseline:** all 25 return as additions. Re-delete them, and re-check whether the
  new baseline added more scheduled workflows before merging.

### 12. `<spinner>` registration — backport of upstream #35292

- **Files:** `packages/tui/src/component/register-spinner.ts` (new),
  `packages/tui/package.json` (export map), and a `registerOpencodeSpinner()` call at
  five sites: `packages/tui/src/app.tsx`,
  `packages/tui/src/component/spinner.tsx`,
  `packages/tui/src/component/prompt/index.tsx`,
  `packages/opencode/src/cli/cmd/run/footer.subagent.tsx`,
  `packages/opencode/src/cli/cmd/run/footer.view.tsx`
- **Upstream:** https://github.com/anomalyco/opencode/pull/35292 ("tui: preserve
  spinner registration"), merged 2026-07-04 as `7a8e7c88f4`. Our baseline v1.17.11 is
  dated 2026-06-25 — nine days earlier, so it predates the fix. Upstream v1.18.9 and
  later carry it.
- **Bug:** each of those five sites used to register `<spinner>` with a bare
  side-effect import, `import "opentui-spinner/solid"`. `opentui-spinner` declares a
  whitelist `sideEffects` (`["./dist/react.mjs", "./dist/solid.mjs"]`), so the module
  survives tree-shaking only while the bundler matches those POSIX patterns against
  the resolved path. Our release build compiles the win32 target ON a
  `windows-latest` runner (`release-cos.yml`: `runner: windows-latest` +
  `OPENCODE_HOST_ONLY=1`); there the match fails, `minify` drops an import that binds
  nothing, `extend({ spinner })` never runs, and the first spinner render kills the
  session with `[Reconciler] Unknown component type: spinner`. Reported on cz-cli
  2.0.3 (Windows). Upstream never saw it: its `build-cli` job bundles every target,
  Windows included, on `blacksmith-4vcpu-ubuntu-2404` (the `windows-2025` runner only
  signs), and dev `bun run` does not tree-shake at all.
- **Measured:** forcing the match to fail (`sideEffects: false` on the installed
  package) collapses a bare-import bundle from 935,609 bytes to 27 — registration and
  all. Cross-compiling with `--target=bun-windows-x64` from macOS keeps it, which is
  why the build host, not the target, is what matters.
- **Why intrusive (no hook):** the catalogue is module-level state inside
  `@opentui/solid`, and these are the modules that render `<spinner>`.
- **No `cz-cli change` banner, deliberately — grep for the call instead:** the edit is
  byte-identical to upstream's, so wrapping it in a banner would make the file differ
  from the fixed upstream file and turn a clean fast-forward into a conflict. The cost
  is that the ledger's usual `rg -n "cz-cli change"` sweep cannot see this patch, so it
  is the one entry that could be reverted by a baseline bump without the sweep noticing.
  The substitute check, added to the re-baseline procedure below, is:

  ```sh
  rg -n 'registerOpencodeSpinner' packages/tui packages/opencode   # 11 hits: 1 definition + import+call at each of the 5 sites
  rg -n 'import "opentui-spinner/solid"' packages/tui packages/opencode   # expect none
  rg -n 'component/register-spinner' packages/tui/package.json     # the export map entry
  ```

  The third check is not redundant: the two `packages/opencode` sites import
  `@opencode-ai/tui/component/register-spinner`, which only resolves while
  `packages/tui/package.json`'s `exports` publishes it — and a baseline bump will almost
  certainly overwrite that file, since upstream touches versions and deps in it constantly.
  Both `.ts`-level greps would still pass with the export map reverted, leaving two imports
  of an unpublished subpath.

  The silent-revert window is exactly v1.17.11 → v1.18.9: before it the patch does not
  exist, from v1.18.9 on upstream provides it and this entry is deleted.
- **Verify:** `packages/opencode/test/cli/run/footer.view.test.tsx` asserts a spinner
  renders in the `run` footer (`expect(spinner).toBeDefined()`); it goes RED if the
  registration is gone from that path. Run it plus `packages/tui`'s suite after any
  baseline bump. Neither is in `cz-test.yml`, so this is a manual step. Pins that must
  keep exporting what the fix calls: `opentui-spinner@0.0.7` (`registerSpinner`) and
  `@opentui/solid@0.3.4` (`getComponentCatalogue`).
- **Re-baseline:** once the baseline is at v1.18.9 or newer, upstream provides all of
  this — take upstream's version wholesale and **delete this entry**. Until then, the
  bare imports return on every baseline bump; re-apply from #35292 rather than by
  hand, and check for new `<spinner>` call sites with
  `rg -n 'opentui-spinner|<spinner' packages/tui packages/opencode`.

### 13. `step-finish` provider metadata reaches the part

- **Files:** `packages/schema/src/session-v1.ts` (`StepFinishPart`),
  `packages/opencode/src/session/processor.ts` (the `step-finish` `updatePart` call).
- **Marker:** `//======================== cz-cli change ========================` at both.
- **Upstream value:** `StepFinishPart` has no `metadata` field, and the processor builds the
  part without one.
- **What/why:** upstream feeds the step's `providerMetadata` to `Session.getUsage`, which
  normalizes the fields it knows (anthropic/vertex/bedrock/venice cache tokens, copilot
  `totalNanoAiu` → cost) and drops the rest. So a provider-specific number upstream does not
  normalize cannot leave the server at all. ClickZetta's per-key token quota is one: the AI
  gateway reports it on every response's headers and `@clickzetta/ai-gateway` publishes it as
  `providerMetadata.clickzetta.quota`, with no consumer able to see it. Two additive lines put
  it on the part, after which it rides the exact path `tokens` and `cost` ride — part →
  `message.part.updated` → the TUI's state store → a memo in the sidebar.
- **Why intrusive (no hook):** `TuiEventBus` (`packages/plugin/src/tui.ts`) is subscribe-only
  over a closed event union, and the server-side plugin hooks can neither publish an event nor
  add a route (`chat.headers` is outbound only). No hook carries a response-derived value from
  the server to the TUI.
- **Why this shape:** it is what upstream itself does for the same kind of data.
  `TextPart`/`ReasoningPart`/`ToolPart` already carry `metadata`; `step-finish` was the only
  part that dropped it. The alternative — a cz-owned side channel — was built first (a JSON
  file under `~/.clickzetta`, then a `BroadcastChannel` between the TUI thread and the server
  worker) and both were rejected: they add a mechanism this repo has no other precedent for,
  and the file version needed a freshness window plus a daily-reset heuristic that in-band
  delivery makes unnecessary.
- **Blast radius if lost to a re-baseline:** the token rows go blank. No error, no crash — the
  reader simply finds no `metadata` on the part. Patch 1's history shows an intrusive patch HAS
  been silently lost this way before, so verify by looking at the sidebar after a baseline
  bump, not only by grepping for the marker.
- **Not applied to the v2 path.** `packages/core/src/session/runner/publish-llm-event.ts`
  builds its step settlement as `{ finish, tokens }` and `Step.Ended`
  (`packages/schema/src/session-event.ts`) has no metadata field either, so the same drop
  happens there. It does not matter today: the native runtime is opt-in behind
  `flags.experimentalNativeLlm` (`packages/opencode/src/session/llm.ts`) and the live path is
  ai-sdk. If that flag becomes the default, the token rows go blank until the same two lines
  are added on that surface.
- **Verify:** run a gateway-backed turn against a deployment that sends `x-czgw-ratelimit-*`
  (uat-aimesh does; cn-shanghai-alicloud does not, as of 2026-09-01) and confirm the Quota
  section paints token rows.

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

### 5. Quota/Profile sidebar sections

- **cz files:** `packages/cz-cli/src/opencode-plugin/tui-quota.tsx` (and its
  `tui-quota-{data,format,runtime}.ts` siblings).
- **Mechanism:** registers on the public `sidebar_content` slot
  (`packages/plugin/src/tui.ts`'s `TuiHostSlotMap`), rendering a "Profile" section
  (which profile/account/env/instance/workspace the session is connected as) and a
  "Quota" section (cash balance + per-period token allowance) at `order: 150` — directly after
  upstream's own Context section (`order: 100`) and ahead of MCP/LSP/Todo/Files
  (200/300/400/500).
- **Why:** the readout used to share the prompt's top-right corner with the
  agent/model/provider labels and got squeezed out at 80 columns; the sidebar has
  room and groups it with the Context section reporting the same kind of
  per-session usage facts.
- **Upstream hooks to re-verify on re-baseline:**
  - `sidebar_content` still exists in `TuiHostSlotMap` and still passes
    `props.session_id`.
  - It is still an **append** slot (not `single_winner` like
    `sidebar_title`/`sidebar_footer` next to it) — otherwise these sections would
    displace upstream's Context section instead of composing with it.
  - The order values these sections sit between — 100 (context) / 200 (mcp) / 300
    (lsp) / 400 (todo) / 500 (files) — are still what upstream assigns; `order: 150`
    is only meaningful relative to them.
  - `sidebar_content` is rendered only from
    `packages/tui/src/routes/session/sidebar.tsx`: there is no home-route consumer,
    so these sections are session-only, and the sidebar auto-opens only at ≥120
    columns (`sidebarVisible` in `packages/tui/src/routes/session/index.tsx`) —
    narrower terminals reach it via the toggle. This is upstream's own layout
    policy, not something cz controls, and is the deliberate trade for legibility
    made in place of the old prompt-corner placement.
  - `sidebarVisible`'s FIRST check is `if (session()?.parentID) return false`
    (`routes/session/index.tsx`) — a child (subagent) session never renders the
    sidebar at ANY width, and the toggle cannot override it (checked after that
    early return). So on a child session these sections are gone entirely, not
    merely harder to reach — where the old prompt-corner slot rendered the same
    on parent and child. Expected/accepted: a subagent turn still spends the
    parent's quota and the user returns to the parent session to see it, but this
    is upstream's policy, not cz's, and worth re-verifying it still holds.
  - **Two upstream event shapes this feature reads** (recorded with the header-quota
    change; the older `session.status` subscription had gone unrecorded too):
    - `session.status` — `properties.sessionID` / `properties.status`, driving the
      busy→idle edge that triggers the balance read.
    - `message.part.updated` — `properties.part.type === "step-finish"`, whose `metadata`
      carries the token quota (see intrusive patch 13). The sidebar reads it from the TUI's
      state store rather than from the event, exactly as upstream's Context section reads
      `tokens`, so a rename of that part type or a move of `metadata` shows up as blank
      token rows with no error. `packages/cz-cli/test/tui-quota-data.test.ts` covers the
      reader against a hand-built store; nothing covers the live shape.
- **How the token half travels:** the provider publishes it as
  `providerMetadata.clickzetta.quota` (on the doGenerate result, on the doStream "finish"
  part), opencode carries it onto the step-finish part via patch 13, and the part reaches
  the TUI through the ordinary message pipeline. No cache, no side channel, no persistence
  of cz's own: a reading is attached to the assistant message that produced it, so
  reopening a session shows that session's last reading and a turn aborted before
  step-finish reports nothing. Attribution needs no credential — the message names its own
  `providerID`, which is what the reader filters on.
  - A reading printed by `cz-cli ai-gateway quota` in another terminal does not reach a
    running TUI (it did when this was a file). Both sides still resolve the same entry
    through `classifyClickzettaEntry`, so they can never describe different keys.
- **Token quota no longer comes from Portal.** It used to be a second portal call,
  `/clickzetta-portal/user/listApiKeys`, matched against the key by its masked form. That
  route, `maskApiKey`/`matchKeyUsage`, and the walk over every configured profile hunting
  the one whose portal knew the selected key are all deleted. Only the cash balance is a
  portal read now, and only for the CURRENT profile.
- **Also new on this feature's network path:** `centralPortalHost`/`portalRead`
  (`tui-quota-data.ts`) send the profile's portal token to `api.clickzetta.com`/
  `api.singdata.com` when the profile's own regional host answers an unusable
  business code — a host the user never named in profiles.toml. Confirmed
  intentional: both hosts answer with the SAME tenant-global data (balance, a
  tenant's virtual keys are not per-region facts), the rewrite is pinned to the
  two roots actually measured (see `centralPortalHost`'s docstring), and it only
  fires when the configured host has already failed to answer usably. No config
  escape hatch exists to opt out of the fallback.

---

### 6. `cz-cli serve` flag surface

- **cz files:** `packages/cz-cli/src/bootstrap/runtime.ts` (the `serve` branch:
  `applyServeLogFlags`, `serveInheritedGlobals`).
- **Mechanism:** `cz-cli serve` runs its own yargs instance around upstream's
  `ServeCommand`, so it never passes through upstream's ROOT parser. Two things are
  re-created there: the root parser's logging flags (`--print-logs`, `--log-level`,
  `--pure`), wired to the same env vars upstream's root middleware sets
  (`OPENCODE_PRINT_LOGS`, `OPENCODE_LOG_LEVEL`, `OPENCODE_PURE`), and the cz global
  flags that run-cli has already consumed off the same argv, declared hidden so
  `.strict()` can reject a real typo without rejecting a working invocation.
- **Upstream hooks to re-verify:** `packages/opencode/src/cli/index.ts` still declares
  those three flags on the root parser and its middleware still reads them from those
  env var names; `packages/opencode/src/cli/cmd/serve.ts` still takes its network
  options from `withNetworkOptions`.
- **Failure mode if the hook moves:** the logging flags silently go back to being
  accepted and doing nothing (an env var rename), or `serve` starts rejecting a flag
  it should accept (a new global in cli.ts's `KNOWN_GLOBAL_FLAGS` is covered
  automatically; a new UPSTREAM root flag is not).

## Re-baseline procedure (quick)

1. Fast-forward upstream packages to the new opencode version.
2. `rg -n "cz-cli change" packages/core packages/opencode packages/tui` — expect the
   INTRUSIVE patches above. If any is missing, re-apply it from this ledger. This sweep
   does NOT cover entry 12, which carries no banner on purpose; check it separately with
   `rg -n 'registerOpencodeSpinner' packages/tui packages/opencode` (expect 11 hits) plus
   `rg -n 'component/register-spinner' packages/tui/package.json` for the export map, until
   the baseline reaches v1.18.9, at which point entry 12 is deleted.
3. For each HOOK customization, confirm its "upstream hook to re-verify" still holds.
4. `cd packages/cz-cli && bun run typecheck && bun test`.
5. Update this file if the set of patches changed.
