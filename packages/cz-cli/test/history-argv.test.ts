/**
 * Tier A of the history regression suite: replay every (command, flag-set)
 * combination real users have run on this branch's lineage and assert the current
 * parser still accepts it.
 *
 * The fixture is generated from `czcli.public.otel_logs` by
 * script/export-history-matrix.ts (run manually — it needs the profile and
 * network). Everything here is in-process argv parsing: no handler runs, no
 * network, no filesystem writes. The historical invocations point at production
 * lakehouses and include `task delete`, `sql --write` and `profile remove`, so
 * "parse only" is a safety requirement, not an optimization.
 *
 * A failure names the usage count and user count of what broke. When the failure
 * is a deliberate change, record it in history-regression/known-changes.ts with
 * the reason rather than deleting the case.
 */
import { describe, expect, test } from "bun:test"
import matrix from "./history-regression/matrix.json" with { type: "json" }
import { findKnownChange, isExcludedPath } from "./history-regression/known-changes.js"
import {
  isDeclaredOption,
  replayHistorical,
  type HistoricalFlag,
  type ReplayResult,
} from "./support/history-replay.js"

interface MatrixEntry {
  cmd: string
  sub?: string
  sub2?: string
  flags: HistoricalFlag[]
  usageCount: number
  users: number
  firstSeen: string
  lastSeen: string
  positionalCountMin: number
  versions: string[]
}

interface ValueCase {
  cmd: string
  sub?: string
  sub2?: string
  key: string
  value: string
  usageCount: number
}

const entries = matrix.entries as MatrixEntry[]
const valueCases = matrix.valueCases as ValueCase[]

/** Verdicts that mean "the parser accepted this invocation". */
const ACCEPTED = new Set<ReplayResult["verdict"]>(["PASS", "HELP_OR_VERSION", "SUBCOMMAND_HELP"])

const pathOf = (entry: { cmd: string; sub?: string; sub2?: string }) =>
  [entry.cmd, entry.sub, entry.sub2].filter(Boolean).join(" ")

const tokensOf = (entry: { cmd: string; sub?: string; sub2?: string }) =>
  // `unknown` is not a command: telemetry writes it when the invocation had no
  // positional token at all (src/run-cli.ts:687), i.e. `cz-cli --version`.
  [entry.cmd === "unknown" ? undefined : entry.cmd, entry.sub, entry.sub2].filter(Boolean) as string[]

function describeEntry(entry: MatrixEntry, result: ReplayResult): string {
  return [
    `${pathOf(entry)} [${entry.flags.map((f) => f.key).join(" ") || "no flags"}]`,
    `  ${entry.usageCount} invocations by ${entry.users} user(s), ${entry.firstSeen} → ${entry.lastSeen}`,
    `  versions: ${entry.versions.join(", ") || "unknown"}`,
    `  replayed: cz-cli ${result.argv.join(" ")}`,
    `  verdict:  ${result.verdict}${result.message ? ` — ${result.message}` : ""}`,
    result.missing?.length ? `  missing:  ${result.missing.join(", ")}` : "",
    `  If this change is deliberate, add it to test/history-regression/known-changes.ts.`,
  ]
    .filter(Boolean)
    .join("\n")
}

/**
 * Assert one replayed combination. Excused failures are checked positively — the
 * verdict must be the one the triage entry claims — so a known change cannot
 * quietly start failing in a new way.
 */
function assertAccepted(entry: MatrixEntry, result: ReplayResult): void {
  if (ACCEPTED.has(result.verdict)) return
  const known = findKnownChange(pathOf(entry), result.verdict, result)
  if (known) return
  throw new Error(describeEntry(entry, result))
}

describe("history regression: argv layer", () => {
  test("fixture covers this branch's lineage", () => {
    expect(matrix.scope.versionPatterns).toEqual(["1.17.%", "dev-v1.17%", "dev-v2.%"])
    expect(entries.length).toBeGreaterThan(2000)
    expect(matrix.scope.invocations).toBeGreaterThan(100_000)
  })

  // Highest-usage combinations first, so a regression in something 20k users hit
  // shows up at the top of the failure list rather than after 2,000 rare ones.
  const ordered = [...entries].sort((a, b) => b.usageCount - a.usageCount)

  for (const [index, entry] of ordered.entries()) {
    const path = pathOf(entry)
    const label = `${String(index).padStart(4, "0")} ${path} [${entry.flags.map((f) => f.key).join(",") || "-"}] ×${entry.usageCount}`
    const excluded = isExcludedPath(path)
    if (excluded) {
      test.skip(`${label} — excluded: ${excluded.reason.slice(0, 80)}…`, () => {})
      continue
    }
    test(label, async () => {
      assertAccepted(entry, await replayHistorical(tokensOf(entry), entry.flags))
    })
  }
})

describe("history regression: option values", () => {
  // Every value ever passed to an option that declares `choices`. This is the
  // layer that catches a narrowed enum: the flag still exists and still parses,
  // but a value users relied on is no longer admitted.
  for (const [index, item] of valueCases.entries()) {
    const path = pathOf(item)
    const label = `${String(index).padStart(4, "0")} ${path} --${item.key}=${item.value} ×${item.usageCount}`
    const excluded = isExcludedPath(path)
    if (excluded) {
      test.skip(`${label} — excluded`, () => {})
      continue
    }
    if (!isDeclaredOption(tokensOf(item), item.key)) {
      // The option is not declared on this path at all, so the triple is a
      // normalization artifact rather than a value the command ever accepted.
      // Whether the option still exists somewhere is Tier A's assertion.
      test.skip(`${label} — --${item.key} not declared on '${path}' (normalization artifact)`, () => {})
      continue
    }
    test(label, async () => {
      const flags: HistoricalFlag[] = [{ key: item.key, hadValue: true, value: item.value }]
      // fillRequired: this probe isolates one option's accepted values, so the
      // command's other mandatory options are supplied rather than asserted.
      const result = await replayHistorical(tokensOf(item), flags, { fillRequired: true })
      if (ACCEPTED.has(result.verdict)) return
      if (findKnownChange(path, result.verdict, result)) return
      throw new Error(
        [
          `${path} --${item.key}=${item.value} (${item.usageCount} invocations) is no longer accepted`,
          `  replayed: cz-cli ${result.argv.join(" ")}`,
          `  verdict:  ${result.verdict}${result.message ? ` — ${result.message}` : ""}`,
          `  A narrowed choices list is a breaking change; if deliberate, record it in known-changes.ts.`,
        ].join("\n"),
      )
    })
  }
})

/**
 * The triage matcher decides which failures are allowed to stay green, so its
 * scope has to be exact: an entry excusing one flag must not excuse the next
 * deletion on the same path. yargs makes that easy to get wrong by reporting
 * every unknown argument of an invocation in one message.
 */
describe("history regression: triage matcher scope", () => {
  test("excuses the flag it names", () => {
    expect(findKnownChange("setup", "FLAG_REMOVED", { message: "Unknown argument: partition" })).toBeDefined()
  })

  test("both spellings of one flag are one name", () => {
    // yargs lists the camelCase expansion alongside the flag as given.
    expect(
      findKnownChange("analytics-agent domain create", "FLAG_REMOVED", {
        message: "Unknown arguments: sample-question, sampleQuestion",
      }),
    ).toBeDefined()
  })

  test("does not excuse a deletion that failed alongside the known flag", () => {
    expect(
      findKnownChange("setup", "FLAG_REMOVED", {
        message: "Unknown arguments: partition, another-gone-flag, anotherGoneFlag",
      }),
    ).toBeUndefined()
  })

  test("names are matched whole, not as substrings", () => {
    // The `task list-folders` entry excuses a flag literally named `1` (the value
    // of `--parent -1`); it must not cover every message that contains a "1".
    expect(findKnownChange("task list-folders", "FLAG_REMOVED", { message: "Unknown argument: folder1" })).toBeUndefined()
  })

  test("every missing flag must be named", () => {
    expect(findKnownChange("sql", "FLAG_NOT_IN_ARGV", { missing: ["no-limit"] })).toBeDefined()
    expect(findKnownChange("sql", "FLAG_NOT_IN_ARGV", { missing: ["no-limit", "vcluster"] })).toBeUndefined()
  })

  test("an entry excuses only the verdict it claims", () => {
    expect(findKnownChange("sql", "FLAG_REMOVED", { message: "Unknown argument: no-limit" })).toBeUndefined()
  })
})
