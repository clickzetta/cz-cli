import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { CLICKZETTA_RUNTIME_ASSETS } from "../src/bootstrap/runtime-assets"

/**
 * Locks the runtime-asset shipping surface: every file the compiled binary
 * resolves from `dirname(process.execPath)` must be copied by BOTH installers and
 * emitted by build.ts.
 *
 * Why this test exists. The TUI quota indicator added `tui-quota.tsx` +
 * `tui-quota-runtime.js` and taught build.ts to emit them, but the two installer
 * copy loops each carried their own hand-written filename list and were not
 * updated. `tui-brand.tsx` imports `./tui-quota`, so on an installed binary that
 * import threw and the ENTIRE brand plugin was dropped — silently, because
 * resolveClickzettaTuiPluginSpecifier is best-effort and degrades to the upstream
 * logo. Observed on a real install: upstream opencode logo, terminal title stuck
 * at "OpenCode", no quota indicator. The commit that added the indicator thereby
 * regressed the logo and title that already worked.
 *
 * The failure mode is what makes a test worth having: `dist/` looked complete
 * (build:local globs `clickzetta-*` plus the extra names), so verifying the build
 * output proved nothing. Only the installed binary showed it.
 *
 * These assertions read the scripts as TEXT rather than executing them — they are
 * shell, and the point is to catch a list that fell behind, which is a source-level
 * property. Adding an entry to CLICKZETTA_RUNTIME_ASSETS fails here until every
 * shipper is updated too.
 */

const ROOT = join(import.meta.dir, "..", "..", "..")
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf-8")

const SHIPPERS = [
  // Tarball/curl installer: copies from the archive's bin/ into ~/.local/bin.
  // Reached by BOTH install paths — cos-release.mjs's generated install.sh just
  // downloads, extracts, and delegates to this script.
  "scripts/setup.sh",
  // npm platform packages: copies from the artifact into the published bin/.
  "scripts/npm-publish.sh",
] as const

describe("runtime assets reach the installed binary", () => {
  test("the asset list is non-empty and free of duplicates", () => {
    // A silently-emptied list would make every assertion below vacuous.
    expect(CLICKZETTA_RUNTIME_ASSETS.length).toBeGreaterThan(0)
    expect(new Set(CLICKZETTA_RUNTIME_ASSETS).size).toBe(CLICKZETTA_RUNTIME_ASSETS.length)
  })

  for (const shipper of SHIPPERS) {
    test(`${shipper} copies every runtime asset`, () => {
      const src = read(shipper)
      const missing = CLICKZETTA_RUNTIME_ASSETS.filter((asset) => !src.includes(asset))
      expect(missing).toEqual([])
    })
  }

  test("build.ts emits every runtime asset", () => {
    // build.ts references the assets via their exported constants, so assert on
    // the constant NAMES: a new asset added to the list without an emit site here
    // would ship from nowhere.
    const src = read("packages/cz-cli/script/build.ts")
    const constants = [
      "CLICKZETTA_PROVIDER_ASSET",
      "CLICKZETTA_PLUGIN_ASSET",
      "CLICKZETTA_TUI_PLUGIN_ASSET",
      "CLICKZETTA_TUI_TITLE_ASSET",
      "CLICKZETTA_TUI_QUOTA_ASSET",
      "CLICKZETTA_TUI_QUOTA_RUNTIME_ASSET",
    ]
    // Guards the mapping itself: if an asset joins the list, this arity check fails
    // until the constant is added above and its emit site verified.
    expect(constants.length).toBe(CLICKZETTA_RUNTIME_ASSETS.length)
    const missing = constants.filter((name) => !src.includes(name))
    expect(missing).toEqual([])
  })

  test("the generated PowerShell installer copies every runtime asset", async () => {
    // Windows has no setup.sh: cos-release.mjs emits a self-contained .ps1 that
    // installs directly. It shipped copying ONLY cz-cli.exe and skills, so a
    // Windows install had a working --version and an agent that died on the first
    // required asset. Assert on the RENDERED script, not the template, because the
    // asset list is interpolated.
    const { renderBootstrapPs1 } = await import("../../../scripts/cos-release.mjs")
    const ps1: string = renderBootstrapPs1({
      version: "1.0.0",
      channel: "stable",
      platforms: { "win32-x64": { archive: "a.zip", url: "https://example.invalid/a.zip", checksum: "0" } },
    })
    const missing = CLICKZETTA_RUNTIME_ASSETS.filter((asset) => !ps1.includes(`'${asset}'`))
    expect(missing).toEqual([])
    // A list with no caller ships nothing, which is the bug this replaces.
    expect(ps1).toContain("Copy-RuntimeAssets $ExtractDir $InstallDir")
  })

  test("the brand plugin's relative imports are all shipped assets", () => {
    // tui-brand.tsx is shipped as raw source, so each bare relative import must
    // resolve to a sibling file that the installers also copy. This is the exact
    // link that broke: the import existed, the sibling did not.
    const src = read("packages/cz-cli/src/opencode-plugin/tui-brand.tsx")
    const specifiers = [...src.matchAll(/from "\.\/([\w-]+)"/g)].map((m) => m[1]!)
    expect(specifiers.length).toBeGreaterThan(0)
    for (const specifier of specifiers) {
      const shipped = CLICKZETTA_RUNTIME_ASSETS.some(
        (asset) => asset === `${specifier}.ts` || asset === `${specifier}.tsx`,
      )
      expect(shipped, `tui-brand.tsx imports ./${specifier}, which no installer ships`).toBe(true)
    }
  })

  test("the quota renderer's relative imports are all shipped assets", () => {
    // Same invariant one level down: tui-quota.tsx is also raw source and pulls in
    // the pre-bundled runtime next to it.
    const src = read("packages/cz-cli/src/opencode-plugin/tui-quota.tsx")
    const specifiers = [...src.matchAll(/from "\.\/([\w-]+)\.js"/g)].map((m) => m[1]!)
    expect(specifiers.length).toBeGreaterThan(0)
    for (const specifier of specifiers) {
      const shipped = CLICKZETTA_RUNTIME_ASSETS.includes(`${specifier}.js` as never)
      expect(shipped, `tui-quota.tsx imports ./${specifier}.js, which no installer ships`).toBe(true)
    }
  })
})
