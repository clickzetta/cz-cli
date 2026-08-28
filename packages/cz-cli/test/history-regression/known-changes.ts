/**
 * Triage list for the history-regression suite.
 *
 * Every historical (command, flag-set) combination in matrix.json is expected to
 * still parse. The entries here are the enumerated exceptions: each one names a
 * combination that does NOT parse on this branch, together with why that is not a
 * defect to fix. Anything failing that is NOT listed here is a new finding — which
 * is the whole point: the suite stays green until someone deletes a flag, narrows a
 * choices list, or renames a subcommand, and then it fails with the usage count of
 * what they broke.
 *
 * Adding an entry is a deliberate act. Prefer fixing the CLI; reach for this list
 * only when the historical form genuinely cannot or should not parse here.
 */
import type { Verdict } from "../support/history-replay.js"

export type ChangeKind =
  /**
   * The recorded invocation came from the other active code line. `cz-1.17.11`
   * and `main` are separate trees sharing one `1.17.x` version space, so a
   * version-based scope filter cannot separate them: some in-scope invocations
   * exercise main's surface, which this tree never had.
   */
  | "lineage"
  /**
   * Never a real CLI flag. The telemetry writer records things that are not user
   * argv — see the notes on individual entries.
   */
  | "artifact"
  /** A deliberate interface change on this branch, with the commit that made it. */
  | "intentional"
  /** The recorded data cannot decide the question either way. */
  | "unassertable"

export interface KnownChange {
  /** Command path as the matrix records it (cmd [sub [sub2]]). */
  path: string
  /** Verdicts this entry excuses. A different verdict on the same path still fails. */
  verdicts: Verdict[]
  /**
   * Tokens that must appear in the failure — a missing-flag key or a fragment of
   * yargs' message. Empty means the whole path is excused for those verdicts.
   */
  matches: string[]
  kind: ChangeKind
  reason: string
}

/**
 * Command paths not replayed at all, with what covers them instead.
 *
 * These are excluded because the parse this suite performs would not be the parse
 * that really happens, so a green result would assert nothing. They are matched as
 * path prefixes.
 */
export const EXCLUDED_PATHS: { path: string; reason: string }[] = [
  {
    path: "agent",
    reason:
      "Delegated before parsing (src/run-cli.ts:153-154, 646-649): every agent subcommand is handed to " +
      "bootstrap/runtime.ts, which builds its OWN yargs tree from opencode cmd() objects (RunCommand, " +
      "SessionCommand, AgentLlmCommand) with a different scriptName and different globals. The registrations " +
      "registerAgentCommand adds to this tree serve help and routing only, so replaying against them would " +
      "test a parser that never sees these invocations. Covered by test/agent-exposed-commands.test.ts, " +
      "test/agent-global-flags.test.ts and the help layer in test/e2e-help.ts.",
  },
  {
    path: "run",
    reason: "Alias of the delegated agent runtime (RUNTIME_COMMANDS, src/run-cli.ts:153). Not in this parser tree.",
  },
  {
    path: "llm",
    reason: "Alias of the delegated agent runtime (RUNTIME_COMMANDS, src/run-cli.ts:153). Not in this parser tree.",
  },
  {
    path: "serve",
    reason: "Alias of the delegated agent runtime (RUNTIME_COMMANDS, src/run-cli.ts:153). Not in this parser tree.",
  },
  {
    path: "update",
    reason:
      "Self-update: the handler downloads and replaces the running binary. Parsing is safe, but the command " +
      "is listed here so no future change to this suite can start running it. Covered by test/update.test.ts.",
  },
  {
    path: "autoupdate",
    reason: "Writes the autoupdate preference into the real config. Covered by test/upstream-autoupdate.test.ts.",
  },
  {
    path: "login",
    reason:
      "Opens a browser for OAuth. Covered by test/login-command.test.ts, test/login-browser.test.ts and " +
      "test/login-target.test.ts.",
  },
  {
    path: "auth",
    reason: "OAuth session management against the live portal. Covered by test/auth-type.test.ts and test/oauth-*.test.ts.",
  },
  {
    path: "mcp serve",
    reason:
      "Long-running server process. Covered by test/mcp-serve-smoke.ts and test/mcp-serve-injection.test.ts.",
  },
]

export const KNOWN_CHANGES: KnownChange[] = [
  {
    path: "analytics-agent domain create",
    verdicts: ["FLAG_REMOVED"],
    matches: ["sample-question"],
    kind: "lineage",
    reason:
      "main declares `--sample-question` (repeatable string array, commit e1b09b5435 'fix: validate analytics " +
      "agent required values (#65)', 2026-07-30, NOT an ancestor of this branch). This tree declares " +
      "`--sample-questions` taking a JSON array (src/commands/analytics-agent.ts:1800). Nothing was removed " +
      "here; the two spellings were never in the same tree.",
  },
  {
    path: "analytics-agent domain update",
    verdicts: ["FLAG_REMOVED"],
    matches: ["sample-question"],
    kind: "lineage",
    reason: "Same divergence as `analytics-agent domain create` — see that entry.",
  },
  {
    path: "analytics-agent datasource load",
    verdicts: ["FLAG_REMOVED"],
    matches: ["domain-id"],
    kind: "lineage",
    reason:
      "main declares `--domain-id` as a repeatable number array on `datasource load`; this tree declares " +
      "`--domain-ids` taking a JSON array (src/commands/analytics-agent.ts:1763). Note `--domain-id` DOES " +
      "exist on this branch elsewhere (domain/table/metric subcommands), so this is scoped to `datasource load`.",
  },
  {
    path: "analytics-agent table update",
    verdicts: ["OPTION_REQUIRED"],
    matches: ["dataset-id"],
    kind: "lineage",
    reason:
      "main takes the dataset id as a POSITIONAL (`table update <dataset-id> --domain-id N`); this tree takes " +
      "it as a required option (`--dataset-id`). The recorded invocations carry the id in the positional " +
      "stream, which the fixture deliberately does not persist, so they replay here without it. The highest-" +
      "impact divergence found (135 invocations, 4 users) — see .claude/reports/history-regression.md.",
  },
  {
    path: "setup",
    verdicts: ["FLAG_REMOVED"],
    matches: ["telemetry", "partition"],
    kind: "artifact",
    reason:
      "`setup` does not go through parseTrackingArgs. trackSetup (src/commands/setup.ts:32-56) records the " +
      "PARSED argv object plus a synthetic `telemetry` key holding the answer to its own prompt, so a setup " +
      "'flag' need not be a CLI flag at all. `--telemetry` never was one. `--partition` is real but belongs to " +
      "`login` (src/commands/login.ts:333): login shares setup's implementation (it imports runAuthConfigure " +
      "from setup.js), so `cz-cli login --partition cn` reports itself as command 'setup' carrying login's " +
      "argv. Same origin for the duplicated camelCase spellings (loginMethod/skipVerify/accountName) and the " +
      "internal `format_explicit` on setup entries: yargs puts both spellings in argv and the dump copies them.",
  },
  {
    path: "task list-folders",
    verdicts: ["FLAG_REMOVED"],
    matches: ["1"],
    kind: "artifact",
    reason:
      "A flag named `1`, from `--parent -1`: parseTrackingArgs strips leading dashes from any token starting " +
      "with `-` (src/telemetry.ts:54), so the negative VALUE `-1` is recorded as a flag key. Not a real flag.",
  },
  {
    path: "sql",
    verdicts: ["FLAG_NOT_IN_ARGV"],
    matches: ["no-limit"],
    kind: "unassertable",
    reason:
      "One invocation passed both `--limit N` and `--no-limit`. Which wins depends on token order, and the " +
      "telemetry flag map is an unordered dict (src/telemetry.ts:38), so the recorded data cannot say what the " +
      "user actually got. Both flags exist and parse; only this contradictory pairing is unassertable.",
  },
]

export function isExcludedPath(path: string): { reason: string } | undefined {
  const hit = EXCLUDED_PATHS.find((entry) => path === entry.path || path.startsWith(entry.path + " "))
  return hit ? { reason: hit.reason } : undefined
}

/** What a replay failed with, as the triage matcher needs to see it. */
export interface FailureEvidence {
  /** Historical flags absent from argv (FLAG_NOT_IN_ARGV). */
  missing?: string[]
  /** yargs' own failure text. */
  message?: string
}

/** yargs failures that blame a comma-separated list of argument names. */
const BLAME_LIST = /^(?:Unknown arguments?|Unknown commands?|Missing required arguments?):\s*(.+)$/

const kebabCase = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

/**
 * Every argument name a failure blames, normalized to one spelling.
 *
 * yargs reports ALL of an invocation's unknown arguments in a single message, and
 * lists both spellings of each: `Unknown arguments: partition, another-gone-flag,
 * anotherGoneFlag`. That is why the matcher below has to require the whole list to
 * be accounted for — matching any one token would let the `setup --partition`
 * artifact entry excuse a genuinely deleted flag that merely failed in the same
 * invocation, silently turning this list into a blanket amnesty for its paths.
 */
function blamedNames(evidence: FailureEvidence): string[] {
  const out = new Set<string>()
  for (const key of evidence.missing ?? []) out.add(kebabCase(key))
  const listed = BLAME_LIST.exec((evidence.message ?? "").trim())
  for (const token of listed?.[1]?.split(",") ?? []) {
    const name = token.trim()
    if (name) out.add(kebabCase(name))
  }
  return [...out]
}

/**
 * The triage entry excusing a failure, if one covers ALL of it.
 *
 * Names are matched whole, not as substrings: `matches: ["1"]` excuses the flag
 * literally named `1` and nothing else. When the failure blames no name list — a
 * coercion error, an `Invalid values:` block — the entry's `matches` fall back to
 * substrings of the message, which is the only handle those failures offer.
 */
export function findKnownChange(
  path: string,
  verdict: Verdict,
  evidence: FailureEvidence,
): KnownChange | undefined {
  const applicable = KNOWN_CHANGES.filter(
    (change) =>
      (path === change.path || path.startsWith(change.path + " ")) && change.verdicts.includes(verdict),
  )
  const blanket = applicable.find((change) => change.matches.length === 0)
  if (blanket) return blanket
  const blamed = blamedNames(evidence)
  if (blamed.length > 0) {
    const excusing = blamed.map((name) =>
      applicable.find((change) => change.matches.some((match) => kebabCase(match) === name)),
    )
    // One unnamed token is enough to make this a new finding: the rest being known
    // says nothing about it.
    return excusing.every(Boolean) ? excusing[0] : undefined
  }
  const message = evidence.message ?? ""
  return applicable.find((change) => change.matches.some((match) => message.includes(match)))
}
