#!/usr/bin/env bun

/**
 * Vendored from ../../opencode/script/build.ts (upstream opencode v1.17.11).
 * Keep this file aligned with upstream when rebasing, and keep local edits
 * constrained to cz_change blocks.
 */

import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { Script } from "@opencode-ai/script"
import {
  CLICKZETTA_PLUGIN_ASSET,
  CLICKZETTA_PROVIDER_ASSET,
  CLICKZETTA_TUI_PLUGIN_ASSET,
} from "../src/bootstrap/runtime-assets"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "../../opencode")

process.chdir(dir)

const generated = await import("../../opencode/script/generate.ts")
import pkg from "../../opencode/package.json"

const singleFlag = process.argv.includes("--single")
const baselineFlag = process.argv.includes("--baseline")
const skipInstall = process.argv.includes("--skip-install")
const sourcemapsFlag = process.argv.includes("--sourcemaps")
const plugin = createSolidTransformPlugin()
const skipEmbedWebUi = process.argv.includes("--skip-embed-web-ui")

async function buildRuntimeAsset(entrypoint: string, outfile: string) {
  const tmp = fs.mkdtempSync(path.join(process.cwd(), ".cz-runtime-asset-"))
  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir: tmp,
    target: "bun",
    format: "esm",
    minify: true,
  })
  if (!result.success) {
    fs.rmSync(tmp, { recursive: true, force: true })
    throw new AggregateError(result.logs, `Failed to build runtime asset ${path.basename(outfile)}`)
  }
  const output = result.outputs.find((item) => item.path.endsWith(".js"))
  if (!output) {
    fs.rmSync(tmp, { recursive: true, force: true })
    throw new Error(`Runtime asset ${path.basename(outfile)} did not emit a JavaScript bundle`)
  }
  fs.copyFileSync(output.path, outfile)
  fs.rmSync(tmp, { recursive: true, force: true })
}

const createEmbeddedWebUIBundle = async () => {
  console.log(`Building Web UI to embed in the binary`)
  const appDir = path.join(import.meta.dirname, "../../app")
  const dist = path.join(appDir, "dist")
  await $`OPENCODE_CHANNEL=${Script.channel} bun run --cwd ${appDir} build`
  const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dist })))
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !file.endsWith(".map"))
    .sort()
  const imports = files.map((file, i) => {
    const spec = path.relative(dir, path.join(dist, file)).replaceAll("\\", "/")
    return `import file_${i} from ${JSON.stringify(spec.startsWith(".") ? spec : `./${spec}`)} with { type: "file" };`
  })
  const entries = files.map((file, i) => `  ${JSON.stringify(file)}: file_${i},`)
  return [
    `// Import all files as file_$i with type: "file"`,
    ...imports,
    `// Export with original mappings`,
    `export default {`,
    ...entries,
    `}`,
  ].join("\n")
}

const embeddedFileMap = skipEmbedWebUi ? null : await createEmbeddedWebUIBundle()

const allTargets: {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}[] = [
  {
    os: "linux",
    arch: "arm64",
  },
  {
    os: "linux",
    arch: "x64",
  },
  {
    os: "linux",
    arch: "x64",
    avx2: false,
  },
  {
    os: "linux",
    arch: "arm64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
    avx2: false,
  },
  {
    os: "darwin",
    arch: "arm64",
  },
  {
    os: "darwin",
    arch: "x64",
  },
  {
    os: "darwin",
    arch: "x64",
    avx2: false,
  },
  {
    os: "win32",
    arch: "arm64",
  },
  {
    os: "win32",
    arch: "x64",
  },
  {
    os: "win32",
    arch: "x64",
    avx2: false,
  },
]

// cz_change: honor Script.hostOnly (OPENCODE_HOST_ONLY / OPENCODE_RELEASE) so each
// CI matrix runner builds ONLY its own platform target. Without this every runner
// builds all targets and races on `gh release upload --clobber`. Vendored from
// upstream opencode build.ts (lost when this file was split off).
const platformTargets = Script.hostOnly
  ? allTargets.filter((item) => item.os === process.platform && item.arch === process.arch)
  : allTargets

const targets = singleFlag
  ? platformTargets.filter((item) => {
      if (item.os !== process.platform || item.arch !== process.arch) {
        return false
      }

      // When building for the current platform, prefer a single native binary by default.
      // Baseline binaries require additional Bun artifacts and can be flaky to download.
      if (item.avx2 === false) {
        return baselineFlag
      }

      // also skip abi-specific builds for the same reason
      if (item.abi !== undefined) {
        return false
      }

      return true
    })
  : platformTargets

await $`rm -rf dist`

// cz_change: dist dir + binary are named "cz-cli" (not upstream "opencode"), so
// the release scripts (scripts/*, packages/npm/*, generated bootstrap.sh) find the
// expected `cz-cli-<os>-<arch>/bin/cz-cli` layout.
const DIST_PREFIX = "cz-cli"

const binaries: Record<string, string> = {}
if (!skipInstall) {
  // cz_change: --ignore-scripts is required on Windows CI. These installs re-resolve
  // the dep tree to pull all-platform prebuilt napi binaries; without --ignore-scripts
  // bun also re-runs install scripts for trustedDependencies, and tree-sitter-powershell
  // then triggers a node-gyp source build that fails on the win32 runner (missing Node
  // headers / common.gypi). These three packages ship prebuilt binaries, so skipping
  // lifecycle scripts is safe and still lands the cross-platform artifacts we need.
  await $`bun install --os="*" --cpu="*" --ignore-scripts @opentui/core@${pkg.dependencies["@opentui/core"]}`
  await $`bun install --os="*" --cpu="*" --ignore-scripts @parcel/watcher@${pkg.dependencies["@parcel/watcher"]}`
  await $`bun install --os="*" --cpu="*" --ignore-scripts @ff-labs/fff-bun@${pkg.dependencies["@ff-labs/fff-bun"]}`
}
for (const item of targets) {
  const name = [
    DIST_PREFIX,
    // changing to win32 flags npm for some reason
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.avx2 === false ? "baseline" : undefined,
    item.abi === undefined ? undefined : item.abi,
  ]
    .filter(Boolean)
    .join("-")
  console.log(`building ${name}`)
  await $`mkdir -p dist/${name}/bin`

  const localPath = path.resolve(dir, "node_modules/@opentui/core/parser.worker.js")
  const rootPath = path.resolve(dir, "../../node_modules/@opentui/core/parser.worker.js")
  const parserWorker = fs.realpathSync(fs.existsSync(localPath) ? localPath : rootPath)
  const workerPath = "./src/cli/tui/worker.ts"

  // Use platform-specific bunfs root path based on target OS
  const bunfsRoot = item.os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"
  const workerRelativePath = path.relative(dir, parserWorker).replaceAll("\\", "/")

  await Bun.build({
    conditions: ["bun", "node"],
    tsconfig: "./tsconfig.json",
    plugins: [plugin],
    external: ["node-gyp"],
    format: "esm",
    minify: true,
    sourcemap: sourcemapsFlag ? "linked" : "none",
    splitting: true,
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: name.replace(DIST_PREFIX, "bun") as any,
      outfile: `dist/${name}/bin/cz-cli`,
      execArgv: [`--user-agent=cz-cli/${Script.version}`, "--use-system-ca", "--"],
      windows: {},
    },
    files: embeddedFileMap ? { "opencode-web-ui.gen.ts": embeddedFileMap } : {},
    entrypoints: [
      // cz_change: build the branded binary from the cz bootstrap while keeping
      // the rest of the opencode build pipeline vendored and aligned.
      "../cz-cli/src/bootstrap/boot.ts",
      parserWorker,
      workerPath,
      ...(embeddedFileMap ? ["opencode-web-ui.gen.ts"] : []),
    ],
    define: {
      FFF_LIBC: JSON.stringify(item.abi === "musl" ? "musl" : "gnu"),
      OPENCODE_VERSION: `'${Script.version}'`,
      OPENCODE_MODELS_DEV: generated.modelsData,
      OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + workerRelativePath,
      OPENCODE_WORKER_PATH: workerPath,
      OPENCODE_CHANNEL: `'${Script.channel}'`,
      OPENCODE_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "",
      // cz_change: build-time injection of the internal OTel collector endpoint/
      // headers. Read from release-pipeline env; empty in the public repo so
      // credentials never ship in source. otel-defaults.ts reads these globals.
      CLICKZETTA_OTEL_ENDPOINT: JSON.stringify(process.env.CLICKZETTA_OTEL_ENDPOINT ?? ""),
      CLICKZETTA_OTEL_HEADERS: JSON.stringify(process.env.CLICKZETTA_OTEL_HEADERS ?? ""),
      ...(item.os === "linux" ? { "process.env.OPENTUI_LIBC": JSON.stringify(item.abi ?? "glibc") } : {}),
    },
  })

  // Smoke test: only run if binary is for current platform
  if (item.os === process.platform && item.arch === process.arch && !item.abi) {
    const binaryPath = `dist/${name}/bin/cz-cli`
    console.log(`Running smoke test: ${binaryPath} --version`)
    try {
      const versionOutput = await $`${binaryPath} --version`.text()
      console.log(`Smoke test passed: ${versionOutput.trim()}`)
    } catch (e) {
      console.error(`Smoke test failed for ${name}:`, e)
      process.exit(1)
    }
  }

  await $`rm -rf ./dist/${name}/bin/tui`
  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version: Script.version,
        preferUnplugged: true,
        os: [item.os],
        cpu: [item.arch],
        ...(item.abi ? { libc: [item.abi] } : {}),
      },
      null,
      2,
    ),
  )
  await Promise.all([
    buildRuntimeAsset(path.resolve(import.meta.dirname, "../src/opencode-plugin/server.ts"), `dist/${name}/bin/${CLICKZETTA_PLUGIN_ASSET}`),
    buildRuntimeAsset(path.resolve(import.meta.dirname, "../../clickzetta-ai-gateway/src/index.ts"), `dist/${name}/bin/${CLICKZETTA_PROVIDER_ASSET}`),
  ])
  // cz_change: ship the TUI brand plugin (home_logo slot) as RAW .tsx SOURCE, not
  // a pre-bundled .js. The compiled binary's host-registered @opentui/solid transform
  // + runtime-plugin rewrite (ensureRuntimePluginSupport, loaded at TUI startup)
  // compiles it at import() time and binds solid to the HOST singleton — the same
  // path dev uses. Pre-bundling it embeds a SECOND @opentui/core that throws the
  // platform gate at load, silently dropping the plugin. opencode/tui stay pristine.
  fs.copyFileSync(
    path.resolve(import.meta.dirname, "../src/opencode-plugin/tui-brand.tsx"),
    `dist/${name}/bin/${CLICKZETTA_TUI_PLUGIN_ASSET}`,
  )
  // cz_change: the brand plugin's terminal-title logic lives in a sibling .ts
  // module (tui-title-brand.ts) so it's unit-testable without the @opentui/solid
  // JSX runtime. tui-brand.tsx imports it via a bare relative "./tui-title-brand",
  // which resolves next to the copied .tsx at runtime — so the sibling must ship
  // alongside it. It's a type-only import of @opencode-ai/plugin/tui (erased at
  // compile), so shipping it as raw source carries no second @opentui/core.
  fs.copyFileSync(
    path.resolve(import.meta.dirname, "../src/opencode-plugin/tui-title-brand.ts"),
    `dist/${name}/bin/tui-title-brand.ts`,
  )
  binaries[name] = Script.version
}

// cz_change: reconstruct a target from its dist key (needed by the archive block).
function findTarget(key: string) {
  return targets.find(
    (t) =>
      key ===
      [
        DIST_PREFIX,
        t.os === "win32" ? "windows" : t.os,
        t.arch,
        t.avx2 === false ? "baseline" : undefined,
        t.abi === undefined ? undefined : t.abi,
      ]
        .filter(Boolean)
        .join("-"),
  )
}

// cz_change: bundle skills from repo-root skills/ (+ skills/external/) into each
// platform dist so setup.sh can install them. `dir` is packages/opencode, so
// ../../ is the repo root.
const allSkillsSrc = path.join(dir, "..", "..", "skills")
if (fs.existsSync(allSkillsSrc)) {
  const scanDirs = [allSkillsSrc]
  const externalDir = path.join(allSkillsSrc, "external")
  if (fs.existsSync(externalDir)) scanDirs.push(externalDir)

  const skillEntries: { name: string; src: string }[] = []
  for (const base of scanDirs) {
    for (const name of fs.readdirSync(base)) {
      const full = path.join(base, name)
      if (name === "external") continue
      if (fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, "SKILL.md"))) {
        skillEntries.push({ name, src: full })
      }
    }
  }

  for (const key of Object.keys(binaries)) {
    for (const { name, src } of skillEntries) {
      const dest = path.join("dist", key, "bin", "skills", name)
      fs.cpSync(src, dest, { recursive: true })
    }
  }
  console.log(`Bundled ${skillEntries.length} skills into all platform dists`)
}

// cz_change: archive path (setup.sh copy + per-platform archives + optional
// gh upload), gated by Script.archive (OPENCODE_ARCHIVE || OPENCODE_RELEASE).
if (Script.archive) {
  const setupSh = path.join(dir, "..", "..", "scripts", "setup.sh")
  const keys = Object.keys(binaries)
  for (const key of keys) {
    if (fs.existsSync(setupSh)) {
      fs.copyFileSync(setupSh, path.join("dist", key, "bin", "setup.sh"))
    }
  }
  console.log(`Archiving ${keys.length} targets in parallel...`)
  const archives = await Promise.all(
    keys.map(async (key) => {
      const target = findTarget(key)!
      const binDir = path.resolve("dist", key, "bin")
      if (target.os === "linux") {
        const archive = `dist/${key}.tar.gz`
        await $`tar -czf ../../${key}.tar.gz *`.cwd(binDir)
        return archive
      }
      if (target.os === "win32") {
        const archive = `dist/${key}.zip`
        const absArchive = path.resolve(archive)
        await $`7z a -tzip ${absArchive} *`.cwd(binDir)
        return archive
      }
      const archive = `dist/${key}.zip`
      await $`zip -r ../../${key}.zip *`.cwd(binDir)
      return archive
    }),
  )
  console.log(`Archived ${archives.length} targets`)
  if (Script.release) {
    const releaseTag = Script.version.startsWith("dev-v") ? Script.version : `v${Script.version}`
    console.log(`Uploading ${archives.length} archives to ${releaseTag}...`)
    await $`gh release upload ${releaseTag} ${archives} --clobber --repo ${process.env.GH_REPO}`
    console.log("Upload complete")
  }
}

export { binaries }
