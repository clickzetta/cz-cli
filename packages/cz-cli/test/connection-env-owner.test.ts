import { expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

// The connection variables are process-global mutable state. Their whole design
// depends on ONE module owning every read and write — provenance (which value is
// the user's and which is ours) cannot be reconstructed by a second writer, and
// that is precisely how `--profile B` came to authenticate as A. Prose in a
// docblock does not hold that line across rebases; this test does.
const OWNER = "src/connection/env.ts"
const VARS = [
  "CZ_PROFILE",
  "CZ_ENV_DERIVED",
  "CZ_PAT",
  "CZ_USERNAME",
  "CZ_PASSWORD",
  "CZ_SERVICE",
  "CZ_PROTOCOL",
  "CZ_INSTANCE",
  "CZ_WORKSPACE",
  "CZ_SCHEMA",
  "CZ_VCLUSTER",
  "CZ_ACCOUNTS_URL",
]

// Matches the ways a var is reachable through the environment — `process.env.X`,
// `process.env["X"]`, and the `env.X` shorthand after `const env = process.env`.
const ACCESS = new RegExp(`(?:process\\.)?env(?:\\.(?:${VARS.join("|")})\\b|\\[\\s*["'\`](?:${VARS.join("|")})["'\`]\\s*\\])`)

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sources(full)
    return full.endsWith(".ts") ? [full] : []
  })
}

test("only connection/env.ts touches the CZ_* connection variables", () => {
  const root = join(import.meta.dir, "..")
  const offenders = sources(join(root, "src"))
    .filter((file) => !file.endsWith(OWNER))
    .flatMap((file) =>
      readFileSync(file, "utf-8")
        .split("\n")
        .flatMap((line, index) => {
          // Comments name these variables constantly while explaining the design.
          const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "")
          return ACCESS.test(code) ? [`${file.slice(root.length + 1)}:${index + 1}: ${line.trim()}`] : []
        }),
    )

  expect(offenders).toEqual([])
})
