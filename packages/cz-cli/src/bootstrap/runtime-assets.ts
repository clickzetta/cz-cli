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
