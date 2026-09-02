/**
 * The curl installer must actually install on Windows, not just recognise it.
 * Run: bun test test/installer-windows.test.ts
 *
 * A Windows user's first move is `curl -fsSL https://cz-cli.ai/install.sh | bash` in Git
 * Bash, and that answered `unsupported platform: mingw64_nt-10.0-26200-x64` — the raw
 * `uname -s` string, because platform() had no mapping for the MSYS family. It reads as
 * "there is no Windows build" when in fact the win32 archives are published like every
 * other platform.
 *
 * This runs the GENERATED script end to end against a fixture archive, with `uname` and
 * `curl` stubbed, because the interesting parts are all shell: the platform mapping, the
 * zip extraction fallback (Git Bash has no unzip), and passing BINARY_NAME through to
 * setup.sh so it installs cz-cli.exe. It cannot prove the .exe runs — that needs Windows.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
// @ts-expect-error — plain .mjs release script, no types
import { renderBootstrapSh } from "../../../scripts/cos-release.mjs"

const ROOT = join(import.meta.dir, "..", "..", "..")
let work: string

/** A stand-in for the published archive: bin/ zipped, exactly as archivePlatform does. */
function fixtureArchive(binaryName: string) {
  const staging = join(work, "staging")
  mkdirSync(staging, { recursive: true })
  writeFileSync(join(staging, binaryName), "#!/bin/sh\necho 2.0.4\n")
  chmodSync(join(staging, binaryName), 0o755)
  writeFileSync(join(staging, "setup.sh"), readFileSync(join(ROOT, "scripts", "setup.sh")))
  // One runtime asset, enough to prove setup.sh's copy loop still runs.
  writeFileSync(join(staging, "tui-quota-runtime.js"), "// stub\n")
  const archive = join(work, "cz-cli.zip")
  // `zip -rq` APPENDS to an existing archive, and the Cygwin/MSYS case builds twice in one
  // work dir — so remove it first rather than accumulating entries.
  rmSync(archive, { force: true })
  const zipped = Bun.spawnSync(["zip", "-rq", archive, "."], { cwd: staging })
  // Check it. An unchecked fixture build is why this file once flaked: a bad archive makes
  // the installer fail at verify_checksum, and a case asserting on the EXTRACTION error
  // then fails with no hint that its input was never valid.
  if (zipped.exitCode !== 0 || !existsSync(archive) || readFileSync(archive).byteLength === 0) {
    throw new Error(`fixture archive build failed (exit ${zipped.exitCode}): ${zipped.stderr.toString()}`)
  }
  return { archive, checksum: createHash("sha256").update(readFileSync(archive)).digest("hex") }
}

/**
 * PATH for one run: the uname/curl stubs, plus whichever extraction tools the case wants.
 *
 * `tar` and `powershell` are stubbed rather than taken from the host, because what
 * extract_zip owns is the ORDER it tries them in — "bsdtar reads zip" is a fact about
 * Windows' tar.exe, and it cannot be asserted on a Linux runner, where tar is GNU tar and
 * does not. The first cut of this test used the host tar and so passed only on macOS. Each
 * stub records that it ran, so a case can prove which link of the chain did the work.
 */
function stubs(input: {
  unameS: string
  unameM: string
  archive: string
  unzip: "real" | "absent"
  tar?: "extracts" | "fails"
  powershell?: "extracts"
  marker: string
}) {
  const bin = join(work, `stub-bin-${Math.random().toString(36).slice(2)}`)
  mkdirSync(bin, { recursive: true })
  const write = (name: string, body: string) => {
    writeFileSync(join(bin, name), body)
    chmodSync(join(bin, name), 0o755)
  }
  const realUnzip = Bun.spawnSync(["sh", "-c", "command -v unzip"]).stdout.toString().trim()

  write("uname", `#!/bin/sh\ncase "$1" in\n  -s) echo "${input.unameS}" ;;\n  -m) echo "${input.unameM}" ;;\n  *) echo "${input.unameS}" ;;\nesac\n`)
  // download() calls: curl -fL --progress-bar URL -o DEST
  write("curl", `#!/bin/sh\nDEST=""\nwhile [ $# -gt 0 ]; do\n  if [ "$1" = "-o" ]; then DEST="$2"; fi\n  shift\ndone\ncp ${JSON.stringify(input.archive)} "$DEST"\n`)

  if (input.tar === "fails") write("tar", "#!/bin/sh\nexit 1\n")
  // extract_zip calls: tar -xf ARCHIVE -C DIR
  if (input.tar === "extracts")
    write("tar", `#!/bin/sh\necho tar >> ${JSON.stringify(input.marker)}\nexec ${JSON.stringify(realUnzip)} -qo "$2" -d "$4"\n`)
  if (input.powershell === "extracts") {
    write("cygpath", '#!/bin/sh\necho "$2"\n')
    write(
      "powershell",
      `#!/bin/sh\necho powershell >> ${JSON.stringify(input.marker)}\nSRC=$(printf '%s' "$4" | sed -n "s/.*-LiteralPath '\\([^']*\\)'.*/\\1/p")\nDST=$(printf '%s' "$4" | sed -n "s/.*-DestinationPath '\\([^']*\\)'.*/\\1/p")\nexec ${JSON.stringify(realUnzip)} -qo "$SRC" -d "$DST"\n`,
    )
  }
  if (input.unzip === "real") return `${bin}:${process.env.PATH}`

  // A sandbox of symlinks to exactly the tools the two scripts need, unzip excluded —
  // dropping the real PATH is not enough, because /usr/bin is both where unzip lives and
  // where everything else does. A case below asserts unzip really is out of reach, so this
  // cannot quietly stop testing what it claims to.
  const sandbox = join(work, "sandbox-bin")
  mkdirSync(sandbox, { recursive: true })
  const tools = [
    "sh", "cp", "rm", "mkdir", "chmod", "cat", "date", "grep", "tr", "awk", "sed", "env",
    "mktemp", "shasum", "sha256sum", "dirname", "basename", "printf", "echo", "test",
  ]
  for (const tool of input.tar ? tools : [...tools, "tar"]) {
    const found = Bun.spawnSync(["sh", "-c", `command -v ${tool} || true`]).stdout.toString().trim()
    // The Cygwin/MSYS case runs twice in one work dir, so this must be re-entrant.
    if (found && !existsSync(join(sandbox, tool))) symlinkSync(found, join(sandbox, tool))
  }
  return `${bin}:${sandbox}`
}

function runInstaller(input: {
  platformKey: string
  binaryName: string
  unameS: string
  unzip?: "real" | "absent"
  tar?: "extracts" | "fails"
  powershell?: "extracts"
}) {
  const { archive, checksum } = fixtureArchive(input.binaryName)
  const script = join(work, "install.sh")
  writeFileSync(
    script,
    renderBootstrapSh({
      version: "2.0.4",
      channel: "stable",
      platforms: { [input.platformKey]: { url: "https://example.invalid/cz-cli.zip", archive: "cz-cli.zip", format: "zip", checksum } },
    }),
  )
  const home = join(work, "home")
  const installDir = join(home, ".local", "bin")
  const marker = join(work, "extractor-used")
  mkdirSync(home, { recursive: true })
  const path = stubs({
    unameS: input.unameS,
    unameM: "x86_64",
    archive,
    unzip: input.unzip ?? "real",
    ...(input.tar ? { tar: input.tar } : {}),
    ...(input.powershell ? { powershell: input.powershell } : {}),
    marker,
  })
  const result = Bun.spawnSync(["sh", script], {
    env: { PATH: path, HOME: home, INSTALL_DIR: installDir, NON_INTERACTIVE: "1" },
  })
  return {
    installDir,
    home,
    path,
    extractorUsed: existsSync(marker) ? readFileSync(marker, "utf-8").trim() : "",
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  }
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "cz-installer-"))
})
afterEach(() => {
  rmSync(work, { recursive: true, force: true })
})

describe("install.sh on Git Bash", () => {
  test("installs cz-cli.exe instead of reporting an unsupported platform", () => {
    const r = runInstaller({ platformKey: "win32-x64", binaryName: "cz-cli.exe", unameS: "MINGW64_NT-10.0-26200" })
    expect(r.stderr).not.toContain("unsupported platform")
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("win32-x64")
    expect(existsSync(join(r.installDir, "cz-cli.exe"))).toBe(true)
    // The POSIX wrapper for Git Bash and the .cmd shim for cmd/PowerShell.
    expect(existsSync(join(r.installDir, "cz-agent"))).toBe(true)
    expect(readFileSync(join(r.installDir, "cz-agent.cmd"), "utf-8")).toContain("agent %*")
    // Runtime assets still land beside the binary — the thing that broke silently before.
    expect(existsSync(join(r.installDir, "tui-quota-runtime.js"))).toBe(true)
    const metadata = JSON.parse(readFileSync(join(r.home, ".clickzetta", "install.json"), "utf-8"))
    expect(metadata.installed_path.endsWith("cz-cli.exe")).toBe(true)
  })

  test("MSYS and Cygwin map onto the same build", () => {
    for (const unameS of ["MSYS_NT-10.0-26200", "CYGWIN_NT-10.0-26200"]) {
      const r = runInstaller({ platformKey: "win32-x64", binaryName: "cz-cli.exe", unameS })
      expect(r.exitCode).toBe(0)
      expect(existsSync(join(r.installDir, "cz-cli.exe"))).toBe(true)
    }
  })

  /**
   * The three links of extract_zip, in order. Git Bash ships no unzip, so which of the
   * others runs there depends on the host — the point being tested is that the chain falls
   * through rather than aborting, which is ours to get right.
   */
  test("falls through to tar when unzip is missing", () => {
    const r = runInstaller({
      platformKey: "win32-x64",
      binaryName: "cz-cli.exe",
      unameS: "MINGW64_NT-10.0-26200",
      unzip: "absent",
      tar: "extracts",
    })
    // Prove the sandbox is what it claims: an unzip in reach would make this vacuous.
    expect(Bun.spawnSync(["sh", "-c", "command -v unzip || true"], { env: { PATH: r.path } }).stdout.toString().trim()).toBe("")
    expect(r.extractorUsed).toBe("tar")
    expect(r.exitCode).toBe(0)
    expect(existsSync(join(r.installDir, "cz-cli.exe"))).toBe(true)
  })

  test("falls through to powershell when neither unzip nor a zip-capable tar is there", () => {
    const r = runInstaller({
      platformKey: "win32-x64",
      binaryName: "cz-cli.exe",
      unameS: "MINGW64_NT-10.0-26200",
      unzip: "absent",
      tar: "fails",
      powershell: "extracts",
    })
    expect(r.extractorUsed).toBe("powershell")
    expect(r.exitCode).toBe(0)
    expect(existsSync(join(r.installDir, "cz-cli.exe"))).toBe(true)
  })

  test("with no extractor at all it says which tools would do", () => {
    const r = runInstaller({
      platformKey: "win32-x64",
      binaryName: "cz-cli.exe",
      unameS: "MINGW64_NT-10.0-26200",
      unzip: "absent",
      tar: "fails",
    })
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain("needs one of: unzip")
  })

  test("a platform with no published build still says so", () => {
    const r = runInstaller({ platformKey: "win32-arm64", binaryName: "cz-cli.exe", unameS: "MINGW64_NT-10.0-26200" })
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain("unsupported platform: win32-x64")
  })

  /** The POSIX path must be untouched: same script, same delegation, no .exe. */
  test("a POSIX host still installs the extensionless binary", () => {
    const r = runInstaller({ platformKey: "darwin-x64", binaryName: "cz-cli", unameS: "Darwin", unzip: "real" })
    expect(r.exitCode).toBe(0)
    expect(existsSync(join(r.installDir, "cz-cli"))).toBe(true)
    expect(existsSync(join(r.installDir, "cz-cli.exe"))).toBe(false)
    expect(existsSync(join(r.installDir, "cz-agent.cmd"))).toBe(false)
  })
})
