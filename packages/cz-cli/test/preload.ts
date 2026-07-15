// cz-cli test preload — mirrors packages/opencode/test/preload.ts: isolate every
// test from the real machine (home dir, profiles, logs) and install the network
// boundary BEFORE any src/ import runs. Wired via bunfig.toml [test] preload.
//
// Isolation strategy (opencode-aligned): tests mock only true boundaries.
//   - Network: globalThis.fetch is intercepted (see support/fetch-boundary.ts).
//   - Filesystem/home: HOME + CLICKZETTA_TEST_HOME point at a per-process temp dir,
//     so profile-store (profiles.toml), logger (sql-history.jsonl) and global dirs
//     all read/write throwaway paths instead of the developer's real ~/.clickzetta.
// No mock.module of our own src is needed or wanted.
import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import { afterAll, beforeEach } from "bun:test"
import { installFetchBoundary } from "./support/fetch-boundary.js"

// Per-process temp home. Set env FIRST — logger.ts and global dirs read homedir()
// / env at import time, so this must land before any src/ module is imported.
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "cz-cli-test-home-"))
fs.mkdirSync(path.join(testHome, ".clickzetta"), { recursive: true })

// Own the home-isolation invariant per-test: many test files save/restore or even
// delete HOME/CLICKZETTA_TEST_HOME in their own hooks, and Bun shares one process
// across files — so without re-establishing these before each test, a later file
// can start with them unset. Re-point them here every time.
function useTestHome() {
  process.env.HOME = testHome
  process.env.CLICKZETTA_TEST_HOME = testHome
}
useTestHome()

// Clear ambient credentials/config so tests never pick up a developer's real env.
for (const key of [
  "CZ_PROFILE",
  "CLICKZETTA_PROFILE",
  "CLICKZETTA_TOKEN",
  "OPENCODE_CONFIG_CONTENT",
  "OPENCODE_CONFIG",
]) {
  delete process.env[key]
}

installFetchBoundary()

// The SDK caches auth tokens at module scope, keyed by instance:pat, and Bun runs
// every test file in one process — so a token cached by one file would let a later
// file's getToken/getStudioContext skip the login fetch and miss its fixtures.
// Clear it before each test so auth always flows through the mocked network.
beforeEach(async () => {
  useTestHome()
  try {
    const { clearTokenCache } = await import("@clickzetta/sdk")
    clearTokenCache()
  } catch {
    // SDK not resolvable in this file's context — nothing to clear.
  }
})

afterAll(() => {
  fs.rmSync(testHome, { recursive: true, force: true })
})
