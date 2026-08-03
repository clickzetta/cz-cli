import { existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

export const CLICKZETTA_PLUGIN_ASSET = "clickzetta-opencode-plugin.js"
export const CLICKZETTA_PROVIDER_ASSET = "clickzetta-ai-gateway.js"
// Shipped as RAW .tsx SOURCE (not a pre-bundled .js): the compiled binary's
// host-registered @opentui/solid transform + runtime-plugin rewrite compiles it
// at import() time and binds solid to the HOST singleton. A pre-bundled .js would
// carry a second @opentui/core copy that throws the platform gate at load. See build.ts.
export const CLICKZETTA_TUI_PLUGIN_ASSET = "clickzetta-tui-brand.tsx"
// The quota indicator's slot renderer — also raw .tsx, for the same reason.
export const CLICKZETTA_TUI_QUOTA_ASSET = "tui-quota.tsx"
// Everything the indicator needs that ISN'T JSX, pre-bundled behind one entry
// (tui-quota-runtime.ts re-exports the data/format/controller modules). It pulls
// in @clickzetta/sdk and the cz connection/llm modules, none of which touch
// @opentui or solid-js, so bundling carries no duplicate runtime.
export const CLICKZETTA_TUI_QUOTA_RUNTIME_ASSET = "tui-quota-runtime.js"
// The brand plugin's terminal-title logic, split into a non-JSX sibling so it is
// unit-testable without the @opentui/solid runtime. tui-brand.tsx imports it as a
// bare relative "./tui-title-brand", so it must sit next to the .tsx at runtime.
export const CLICKZETTA_TUI_TITLE_ASSET = "tui-title-brand.ts"

/**
 * Every file that must land next to the installed binary, because the compiled
 * cz-cli resolves them from `dirname(process.execPath)` (see
 * resolveRuntimeModulePath below).
 *
 * This list is the SINGLE SOURCE OF TRUTH and exists because the set drifted:
 * the TUI quota indicator added tui-quota.tsx + tui-quota-runtime.js and taught
 * build.ts to emit them, but the two installer copy loops (scripts/setup.sh,
 * scripts/npm-publish.sh) kept their own hand-written list and were not updated.
 * tui-brand.tsx imports ./tui-quota, so on an installed binary that import threw
 * and the ENTIRE brand plugin was dropped — silently, since the specifier resolver
 * is best-effort. Net effect: upstream opencode logo, title stuck on "OpenCode",
 * no quota indicator, i.e. the commit that added the indicator also regressed the
 * logo and title that already worked.
 *
 * A missing asset can therefore be invisible in `dist/` and fatal once installed.
 * test/runtime-assets-installers.test.ts asserts both installers cover this list,
 * so adding an entry here fails the suite until the installers are updated too.
 */
export const CLICKZETTA_RUNTIME_ASSETS = [
  CLICKZETTA_PROVIDER_ASSET,
  CLICKZETTA_PLUGIN_ASSET,
  CLICKZETTA_TUI_PLUGIN_ASSET,
  CLICKZETTA_TUI_TITLE_ASSET,
  CLICKZETTA_TUI_QUOTA_ASSET,
  CLICKZETTA_TUI_QUOTA_RUNTIME_ASSET,
] as const

function resolveRuntimeModulePath(options: { source: string; bundled: string }) {
  if (existsSync(options.source)) return options.source
  const bundled = path.resolve(path.dirname(process.execPath), options.bundled)
  if (existsSync(bundled)) return bundled
  throw new Error(`Missing ClickZetta runtime asset: ${options.bundled}`)
}

// Like resolveRuntimeModulePath but returns undefined instead of throwing when
// the asset is absent — used for the optional TUI brand plugin so a build that
// didn't bundle it degrades gracefully to the upstream logo rather than crashing.
function resolveOptionalRuntimeModulePath(options: { source: string; bundled: string }) {
  if (existsSync(options.source)) return options.source
  const bundled = path.resolve(path.dirname(process.execPath), options.bundled)
  if (existsSync(bundled)) return bundled
  return undefined
}

export function resolveClickzettaPluginSpecifier() {
  return pathToFileURL(resolveRuntimeModulePath({
    source: path.resolve(import.meta.dirname, "../opencode-plugin/server.ts"),
    bundled: CLICKZETTA_PLUGIN_ASSET,
  })).href
}

export function resolveClickzettaProviderSpecifier() {
  return pathToFileURL(resolveRuntimeModulePath({
    source: path.resolve(import.meta.dirname, "../../../clickzetta-ai-gateway/src/index.ts"),
    bundled: CLICKZETTA_PROVIDER_ASSET,
  })).href
}

// Optional TUI brand plugin (home_logo slot). Returns undefined when the asset
// isn't present so branding is best-effort and never breaks TUI startup.
export function resolveClickzettaTuiPluginSpecifier() {
  const resolved = resolveOptionalRuntimeModulePath({
    source: path.resolve(import.meta.dirname, "../opencode-plugin/tui-brand.tsx"),
    bundled: CLICKZETTA_TUI_PLUGIN_ASSET,
  })
  return resolved ? pathToFileURL(resolved).href : undefined
}
