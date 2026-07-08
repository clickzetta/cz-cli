#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

await import("./generate.ts")

import { Script } from "@opencode-ai/script"
import pkg from "../package.json"

// Load migrations from migration directories
const migrationDirs = (
  await fs.promises.readdir(path.join(dir, "migration"), {
    withFileTypes: true,
  })
)
  .filter((entry) => entry.isDirectory() && /^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}/.test(entry.name))
  .map((entry) => entry.name)
  .sort()

const migrations = await Promise.all(
  migrationDirs.map(async (name) => {
    const file = path.join(dir, "migration", name, "migration.sql")
    const sql = await Bun.file(file).text()
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
    const timestamp = match
      ? Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        )
      : 0
    return { sql, timestamp, name }
  }),
)
console.log(`Loaded ${migrations.length} migrations`)

const singleFlag = process.argv.includes("--single")
const baselineFlag = process.argv.includes("--baseline")
const plugin = createSolidTransformPlugin()
const skipEmbedWebUi = process.argv.includes("--skip-embed-web-ui")

const createEmbeddedWebUIBundle = async () => {
  console.log(`Building Web UI to embed in the binary`)
  const appDir = path.join(import.meta.dirname, "../../app")
  const dist = path.join(appDir, "dist")
  await $`bun run --cwd ${appDir} build`
  const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dist })))
    .map((file) => file.replaceAll("\\", "/"))
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
    os: "win32",
    arch: "arm64",
  },
  {
    os: "win32",
    arch: "x64",
  },
]

const platformTargets = Script.hostOnly
  ? allTargets.filter((item) => item.os === process.platform && item.arch === process.arch)
  : allTargets

const targets = singleFlag
  ? platformTargets.filter((item) => {
      if (item.os !== process.platform || item.arch !== process.arch) {
        return false
      }

      if (item.avx2 === false) {
        return baselineFlag
      }

      if (item.abi !== undefined) {
        return false
      }

      return true
    })
  : platformTargets

console.log(`Building ${targets.length}/${allTargets.length} targets: ${targets.map((t) => [t.os, t.arch, t.avx2 === false ? "baseline" : "", t.abi].filter(Boolean).join("-")).join(", ")}`)

fs.rmSync("dist", { recursive: true, force: true })

const DIST_PREFIX = "cz-cli"

const binaries: Record<string, string> = {}
for (let i = 0; i < targets.length; i++) {
  const item = targets[i]
  const name = [
    DIST_PREFIX,
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.avx2 === false ? "baseline" : undefined,
    item.abi === undefined ? undefined : item.abi,
  ]
    .filter(Boolean)
    .join("-")
  const t0 = performance.now()
  console.log(`[${i + 1}/${targets.length}] building ${name}`)
  fs.mkdirSync(`dist/${name}/bin`, { recursive: true })

  const localPath = path.resolve(dir, "node_modules/@opentui/core/parser.worker.js")
  const rootPath = path.resolve(dir, "../../node_modules/@opentui/core/parser.worker.js")
  const parserWorker = fs.realpathSync(fs.existsSync(localPath) ? localPath : rootPath)
  const workerPath = "./src/cli/cmd/tui/worker.ts"
  const rgPath = "./src/file/ripgrep.worker.ts"

  // Use platform-specific bunfs root path based on target OS
  const bunfsRoot = item.os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"
  const workerRelativePath = path.relative(dir, parserWorker).replaceAll("\\", "/")

  await Bun.build({
    conditions: ["browser"],
    tsconfig: "./tsconfig.json",
    plugins: [plugin],
    external: ["node-gyp"],
    format: "esm",
    minify: true,
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
      "./src/index.ts",
      parserWorker,
      workerPath,
      rgPath,
      ...(embeddedFileMap ? ["opencode-web-ui.gen.ts"] : []),
    ],
    define: {
      CLICKZETTA_VERSION: `'${Script.version}'`,
      CLICKZETTA_MIGRATIONS: JSON.stringify(migrations),
      OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + workerRelativePath,
      CLICKZETTA_WORKER_PATH: workerPath,
      CLICKZETTA_RIPGREP_WORKER_PATH: rgPath,
      CLICKZETTA_CHANNEL: `'${Script.channel}'`,
      CLICKZETTA_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "",
      // OTel collector credentials are injected at build time from CI secrets.
      // Local/dev builds inject empty strings, which causes telemetry to no-op.
      CLICKZETTA_OTEL_ENDPOINT: JSON.stringify(process.env.CLICKZETTA_OTEL_ENDPOINT ?? ""),
      CLICKZETTA_OTEL_HEADERS: JSON.stringify(process.env.CLICKZETTA_OTEL_HEADERS ?? ""),
    },
  })

  // Ad-hoc codesign for macOS binaries to prevent Gatekeeper killing the process
  if (item.os === "darwin" && process.platform === "darwin") {
    const binaryPath = `dist/${name}/bin/cz-cli`
    console.log(`Codesigning: ${binaryPath}`)
    await $`codesign --force --sign - ${binaryPath}`
    await $`xattr -dr com.apple.quarantine ${binaryPath}`.nothrow()
  }

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

  fs.rmSync(`./dist/${name}/bin/tui`, { recursive: true, force: true })
  console.log(`[${i + 1}/${targets.length}] ${name} done in ${((performance.now() - t0) / 1000).toFixed(1)}s`)
  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version: Script.version,
        os: [item.os],
        cpu: [item.arch],
      },
      null,
      2,
    ),
  )
  binaries[name] = Script.version
}

const CZ_CLI_PLATFORM_MAP: Record<string, string | null> = {
  // Python cz-tool binary is no longer needed — cz-cli is now built-in via @clickzetta/cli
}

async function bundleCzCli(distBinDir: string, os: string, arch: string) {
  // No-op: Python cz-tool removed. cz-cli functionality is now built into the binary.
}

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

// Python cz-tool bundling removed — cz-cli is now built-in via @clickzetta/cli

// Bundle all skills from skills/ and skills/external/ into each platform dist
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

// Bundle the musl runtime (loader + libstdc++/libgcc_s) into x64 musl dists so
// the archive can self-install on old-glibc Linux (e.g. CentOS/RHEL 7) with no
// root and no network: setup.sh points the ELF interpreter at a per-user copy
// of the loader and serves the rest via LD_LIBRARY_PATH. Only x64 musl targets
// carry these libs; glibc/arm64/Alpine installs are untouched.
const muslRuntimeSrc = path.join(__dirname, "musl-runtime", "x64")
if (fs.existsSync(muslRuntimeSrc)) {
  for (const key of Object.keys(binaries)) {
    const target = findTarget(key)
    if (!target || target.os !== "linux" || target.arch !== "x64" || target.abi !== "musl") continue
    const destLib = path.join("dist", key, "bin", "lib")
    fs.mkdirSync(destLib, { recursive: true })
    for (const f of fs.readdirSync(muslRuntimeSrc)) {
      fs.copyFileSync(path.join(muslRuntimeSrc, f), path.join(destLib, f))
    }
    console.log(`Bundled musl runtime into ${key}/bin/lib`)
  }
}

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
