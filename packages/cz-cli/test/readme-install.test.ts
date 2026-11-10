import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// The installer is served from cz-cli.ai/install.sh, not from a GitHub Release asset:
// release archives never include install.sh, so a github.com/.../download/install.sh URL
// returns 404 (issue #148). This reads the README as text and locks the documented
// commands; it does not probe the network, so unrelated PR CI never depends on cz-cli.ai.
const readme = readFileSync(join(import.meta.dir, "..", "..", "..", "README.md"), "utf-8")
const installCommands = readme.split("\n").filter((line) => /curl\b.*\binstall\.sh/.test(line))

describe("README install commands", () => {
  test("documents at least the one-line install and the pinned-version example", () => {
    expect(installCommands.length).toBeGreaterThanOrEqual(2)
  })

  test("never points at a GitHub Release install.sh asset", () => {
    expect(readme).not.toMatch(/github\.com\/[^\s)]*releases\/[^\s)]*install\.sh/)
  })

  test.each(installCommands)("%s fetches cz-cli.ai/install.sh and runs it with bash", (line) => {
    expect(line).toContain("https://cz-cli.ai/install.sh")
    expect(line).toMatch(/\|\s*bash\b/)
  })

  test("a pinned version is passed to the installer, not set as a curl environment variable", () => {
    const pinned = installCommands.filter((line) => /--version|\bbash -s\b/.test(line))
    expect(pinned.length).toBeGreaterThan(0)
    for (const line of installCommands) expect(line).not.toMatch(/^\s*CZ_VERSION=/)
  })
})
