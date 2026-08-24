import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { coalesceJsonArrayOptionArgs } from "../src/cli.ts"

/**
 * Argument-surface hardening: one describe per defect, each named after what used
 * to happen. Every case runs the real binary, because all of these were failures
 * of the parser boundary rather than of a command's logic.
 *
 * The profile in the fixture points at an unroutable host on purpose: a case that
 * reaches the network has passed the parser, and CONNECTION_ERROR/TASK_ERROR is
 * therefore the "accepted" outcome these tests assert against.
 */

const PROFILES = `default_profile = "p1"

[oauth.sess]
expire_time_ms = 3600000
obtained_at = 1000000000000

[profiles.p1]
instance = "inst"
service = "api.invalid.example.com"
workspace = "ws"
schema = "public"
vcluster = "default"
pat = "pat-token"
oauth = "sess"

[profiles.p2]
instance = "inst2"
service = "api.invalid.example.com"
workspace = "ws2"
pat = "pat-token-2"
`

function makeHome(profiles = PROFILES): string {
  const home = mkdtempSync(join(tmpdir(), "cz-argsafe-"))
  mkdirSync(join(home, ".clickzetta"), { recursive: true })
  writeFileSync(join(home, ".clickzetta", "profiles.toml"), profiles)
  return home
}

const HOME = makeHome()

/**
 * bun's 5s default is too tight for two kinds of case here: one that passes the
 * parser and waits for the unroutable host's socket to fail, and one that boots the
 * agent runtime (which imports opencode before it can even report a bad flag).
 */
const SLOW_SPAWN = 60_000

/**
 * Same two invocation modes as the e2e runners: from source under bun by default,
 * or the compiled binary when CZ_CLI_BIN points at one (`test:ci`). A compiled
 * binary has the entry baked in and takes no entry argument — passing one turns the
 * path into a bogus first positional.
 */
const BINARY = process.env.CZ_CLI_BIN ?? "bun"
const BINARY_ENTRY = process.env.CZ_CLI_BIN ? [] : ["./src/main.ts"]

function run(args: string[], env: Record<string, string> = {}, home = HOME) {
  const result = spawnSync(BINARY, [...BINARY_ENTRY, ...args], {
    cwd: import.meta.dir + "/..",
    encoding: "utf-8",
    env: { ...process.env, HOME: home, CLICKZETTA_TEST_HOME: home, NO_COLOR: "1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  })
  return {
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
    exitCode: result.status ?? 1,
  }
}

function errorOf(stdout: string): Record<string, any> {
  try {
    return (JSON.parse(stdout.split("\n")[0] ?? "{}") as Record<string, any>).error ?? {}
  } catch {
    return {}
  }
}

/** A stack trace on stderr means an exception escaped instead of being reported. */
function hasStackTrace(stderr: string): boolean {
  return /\n\s+at\s/.test(stderr) || stderr.includes("Bun v")
}

describe("a repeated scalar option used to become an array", () => {
  test("--field twice takes the last one instead of crashing in extractField", () => {
    const r = run(["auth", "list", "--field", "sessions", "--field", "active_profile"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe("p1")
    expect(hasStackTrace(r.stderr)).toBe(false)
  })

  test("--protocol twice no longer reaches normalizeProtocol as an array", () => {
    const r = run(["status", "--protocol", "http", "--protocol", "https"])
    expect(r.stdout).not.toContain("toLowerCase is not a function")
  }, SLOW_SPAWN)

  test("--format twice honors the last value instead of silently falling back to json", () => {
    const r = run(["auth", "list", "--format", "json", "--format", "text"])
    expect(r.stdout.startsWith("{")).toBe(false)
    expect(r.stdout.split("\t")[0]).toBe("sess")
  })

  test("--profile twice selects the last profile rather than none", () => {
    // p2 exists, so the run gets as far as the network; the old array form
    // resolved to no profile at all and reported a missing workspace.
    const r = run(["status", "--profile", "p1", "--profile", "p2", "--field", "error"])
    expect(r.stdout).not.toContain("Workspace is required")
  }, SLOW_SPAWN)

  test("an option declared repeatable still collects every value", () => {
    const home = makeHome()
    const created = run([
      "profile", "create", "multi",
      "--instance", "i", "--service", "s", "--workspace", "w", "--pat", "t",
      "--header", "A=1", "--header", "B=2", "--skip-verify",
    ], {}, home)
    expect(created.exitCode).toBe(0)
    const detail = run(["profile", "detail", "multi", "--format", "json"], {}, home)
    expect(detail.stdout).toContain('"A":"1"')
    expect(detail.stdout).toContain('"B":"2"')
  }, SLOW_SPAWN)
})

describe("a numeric option fed junk used to become NaN silently", () => {
  test("--count abc is a usage error instead of an empty answer", () => {
    const r = run(["task", "cron-preview", "0 0 * * *", "--count", "abc"])
    expect(r.exitCode).toBe(2)
    expect(errorOf(r.stdout).code).toBe("USAGE_ERROR")
    expect(errorOf(r.stdout).message).toContain("--count")
  })

  test("the message names the flag as the user typed it, not camelCased", () => {
    const r = run(["task", "cdc", "list", "--page-size", "zz"])
    expect(errorOf(r.stdout).message).toContain("--page-size")
    expect(errorOf(r.stdout).message).not.toContain("pageSize")
  })

  test("a valid number is untouched (the guard does not false-positive)", () => {
    const r = run(["task", "cron-preview", "0 0 * * *", "--count", "3"])
    expect(errorOf(r.stdout).code).not.toBe("USAGE_ERROR")
  }, SLOW_SPAWN)

  test("the usage error renders as a row in row-oriented formats", () => {
    const r = run(["sql", "select 1", "--timeout", "abc", "--format", "text"])
    expect(r.stdout).toBe("ERROR USAGE_ERROR: Invalid number value for: --timeout")
  }, SLOW_SPAWN)
})

describe("an empty option value used to overwrite the profile", () => {
  test("--workspace with no value leaves the profile's workspace in place", () => {
    const r = run(["status", "--workspace", "", "--field", "error"])
    expect(r.stdout).not.toContain("Workspace is required")
  }, SLOW_SPAWN)

  test("--instance with no value leaves the profile's instance in place", () => {
    const r = run(["status", "--instance", "", "--field", "error"])
    expect(r.stdout).not.toContain("Instance is required")
  }, SLOW_SPAWN)
})

describe("a mistyped --profile used to be reported as missing credentials", () => {
  test("the error names the profile and the way to list them", () => {
    const r = run(["status", "--profile", "ghost"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stdout).code).toBe("PROFILE_NOT_FOUND")
    expect(errorOf(r.stdout).message).toContain("ghost")
  })

  test("CZ_PROFILE naming a missing profile is caught on a connecting command", () => {
    expect(errorOf(run(["status"], { CZ_PROFILE: "ghost" }).stdout).code).toBe("PROFILE_NOT_FOUND")
  })

  // The guard is keyed on "does this invocation connect", not on "was a profile
  // named". Keyed the other way, a stale CZ_PROFILE — a profile deleted while still
  // exported in the shell — failed the very commands that fix it, including the
  // `cz-cli profile list` the error message recommends.
  test("a stale CZ_PROFILE leaves the recovery path working", () => {
    const ghost = { CZ_PROFILE: "ghost" }
    expect(run(["profile", "list", "--field", "name"], ghost).stdout).toBe("p1")
    expect(run(["--version"], ghost).exitCode).toBe(0)
    expect(errorOf(run(["auth", "list"], ghost).stdout).code).toBeUndefined()
  })

  test("a typed name is reported even on a command that never connects", () => {
    // Typed, so it is a typo wherever it appears — unlike an inherited CZ_PROFILE,
    // which such a command still ignores (see the recovery-path test above).
    expect(errorOf(run(["auth", "list", "--profile", "ghost"]).stdout).code).toBe("PROFILE_NOT_FOUND")
  })

  test("a profile-creating command still accepts a name that does not exist yet", () => {
    const home = makeHome()
    const r = run([
      "profile", "create", "brandnew",
      "--instance", "i", "--service", "s", "--workspace", "w", "--pat", "t", "--skip-verify",
    ], { CZ_PROFILE: "ghost" }, home)
    expect(r.exitCode).toBe(0)
  }, SLOW_SPAWN)

  test("row-oriented formats get the one-line form", () => {
    const r = run(["status", "--profile", "ghost", "--format", "text"])
    expect(r.stdout.startsWith("ERROR PROFILE_NOT_FOUND:")).toBe(true)
  })

  test("--help is never blocked by it", () => {
    expect(run(["status", "--profile", "ghost", "--help"]).exitCode).toBe(0)
  })

  test("the commands that CREATE a profile still accept a new name", () => {
    // `login`/`setup` take the name they are about to create; --profile is hidden
    // there and must not be validated against what exists today.
    expect(run(["login", "--profile", "brandnew", "--help"]).exitCode).toBe(0)
    expect(run(["setup", "--profile", "brandnew", "--help"]).exitCode).toBe(0)
  })
})

describe("a bad --file used to print a stack trace and nothing on stdout", () => {
  test("an unreadable path is a named error on stdout", () => {
    const r = run(["sql", "--file", "/nonexistent.sql"])
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stdout).code).toBe("FILE_READ_ERROR")
    expect(errorOf(r.stdout).message).toContain("/nonexistent.sql")
    expect(hasStackTrace(r.stderr)).toBe(false)
  })

  test("the positional statement wins over --file, as --help documents", () => {
    // Priority is positional > -e/--execute > -f/--file: a broken --file next to a
    // real statement must therefore not be read at all.
    const r = run(["sql", "select 1", "--file", "/nonexistent.sql"])
    expect(errorOf(r.stdout).code).not.toBe("FILE_READ_ERROR")
  }, SLOW_SPAWN)
})

describe("an unhandled exception used to escape as a bare stack", () => {
  test("a throw from the pre-command connection setup renders as an envelope", () => {
    // An invalid auth_type throws from resolveConnectionConfig, which the CLI first
    // calls before any command's try/catch when a connection flag is present.
    const home = makeHome(`default_profile = "bad"

[profiles.bad]
instance = "i"
service = "api.invalid.example.com"
workspace = "w"
pat = "t"
auth_type = "passwrod"
`)
    const r = run(["status", "--instance", "other"], {}, home)
    expect(r.exitCode).toBe(1)
    expect(errorOf(r.stdout).code).toBe("INVALID_AUTH_TYPE")
    expect(hasStackTrace(r.stderr)).toBe(false)
  })
})

describe("`--` operands used to be dropped", () => {
  test("sql -- <statement> reaches the statement", () => {
    const r = run(["sql", "--", "select 1"])
    expect(errorOf(r.stdout).message).not.toContain("No SQL statements found")
  }, SLOW_SPAWN)

  test("an empty invocation still reports no statement", () => {
    expect(errorOf(run(["sql"]).stdout).message).toContain("No SQL statements found")
  })
})

describe("a fragmented JSON value used to swallow the next positional", () => {
  test("the positional survives when the JSON arrives split on its inner space", () => {
    const r = run([
      "task", "save-cron",
      "--output-tables", '[{"outputTableName": "a"}]',
      "mytask", "--cron", "0 30 9 * * ? *",
    ])
    expect(errorOf(r.stdout).message ?? "").not.toContain("Not enough non-option arguments")
  }, SLOW_SPAWN)
})

describe("usage errors follow the chosen format", () => {
  test("a mistyped flag is one ERROR row under --format text", () => {
    // It used to answer with a JSON envelope, so a text-mode caller had to handle
    // two error shapes: this one and error()'s ERROR line.
    const r = run(["schema", "list", "--limt", "5", "--format", "text"])
    expect(r.exitCode).toBe(2)
    expect(r.stdout).toBe("ERROR USAGE_ERROR: Unknown argument: limt")
  })

  test("the suggestion is carried into the row form too", () => {
    const r = run(["schema", "list", "--formt", "json", "--format", "text"])
    expect(r.stdout).toBe("ERROR USAGE_ERROR: Unknown argument: formt. Did you mean '--format'?")
  })

  test("json keeps the structured shape, did_you_mean included", () => {
    const e = errorOf(run(["schema", "list", "--formt", "json"]).stdout)
    expect(e.code).toBe("USAGE_ERROR")
    expect(e.did_you_mean).toBe("--format")
  })
})

describe("status reports its outcome in the exit code", () => {
  test("an unreachable instance exits non-zero while still describing itself", () => {
    const r = run(["status"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stdout).data.connected).toBe(false)
  }, SLOW_SPAWN)
})

describe("the agent subtree used to localize its messages", () => {
  // robustness.test.ts #6 pins this for the cz command tree. The agent tree runs on
  // its own yargs instances (bootstrap/runtime.ts, commands/agent-llm.ts), which had
  // no .locale("en"), so the same command answered in Chinese on a zh_CN machine.
  const ZH = { LANG: "zh_CN.UTF-8", LC_ALL: "zh_CN.UTF-8" }

  test("an invalid choice on an agent command stays English", () => {
    const r = run(["agent", "session", "list", "--format", "csv"], ZH)
    expect(r.stdout).not.toMatch(/[一-鿿]/)
    expect(r.stdout).toContain("Invalid values")
  }, SLOW_SPAWN)

  test("an unknown flag on agent llm stays English", () => {
    const r = run(["agent", "llm", "show", "--bogus"], ZH)
    expect(r.stdout).not.toMatch(/[一-鿿]/)
  }, SLOW_SPAWN)

  test("agent llm help stays English", () => {
    const r = run(["agent", "llm"], ZH)
    expect(r.stdout).not.toMatch(/[一-鿿]/)
    expect(r.stdout).toContain("Commands:")
  }, SLOW_SPAWN)
})

describe("agent llm used to turn its own help into an error", () => {
  test("a bare group prints help and exits 0, like every other group", () => {
    const r = run(["agent", "llm"])
    expect(r.exitCode).toBe(0)
    expect(r.stderr).not.toContain("subcommand help shown")
  }, SLOW_SPAWN)

  test("an unknown flag is reported once, on stdout", () => {
    const r = run(["agent", "llm", "show", "--bogus"])
    expect(r.exitCode).toBe(2)
    expect(errorOf(r.stdout).code).toBe("USAGE_ERROR")
    expect(r.stderr).not.toContain("Error:")
  }, SLOW_SPAWN)
})

describe("serve used to accept a mistyped flag and start anyway", () => {
  test("an unknown flag is rejected instead of starting on a random port", () => {
    // The default port is 0, so a swallowed --port typo meant a server on an
    // unpredictable port. If this ever regresses the process would not exit and the
    // timeout below is what fails.
    const r = run(["serve", "--prot", "45999"])
    expect(r.exitCode).not.toBe(0)
    expect(r.stdout + r.stderr).toContain("prot")
    expect(r.stdout + r.stderr).not.toContain("listening")
  }, SLOW_SPAWN)

  test("the flags upstream's root parser owns are declared, not swallowed", () => {
    const help = run(["serve", "--help"])
    expect(help.stdout).toContain("--print-logs")
    expect(help.stdout).toContain("--log-level")
    expect(help.stdout).toContain("--pure")
    expect(help.stdout).not.toMatch(/[一-鿿]/)
  }, SLOW_SPAWN)
})

describe("coalesceJsonArrayOptionArgs (unit)", () => {
  test("merges the fragments of one split JSON value and stops there", () => {
    expect(
      coalesceJsonArrayOptionArgs(["--output-tables", '[{"outputTableName":', '"a"}]', "mytask"]),
    ).toEqual(["--output-tables", '[{"outputTableName":"a"}]', "mytask"])
  })

  test("leaves an already-closed value alone", () => {
    expect(coalesceJsonArrayOptionArgs(["--output-tables", "[]", "mytask"])).toEqual([
      "--output-tables", "[]", "mytask",
    ])
  })

  test("a bracket inside a string does not end the value early", () => {
    expect(coalesceJsonArrayOptionArgs(["--output-tables", '[{"n":', '"a]b"}]', "task"])).toEqual([
      "--output-tables", '[{"n":"a]b"}]', "task",
    ])
  })

  test("a value that is not JSON at all absorbs nothing", () => {
    expect(coalesceJsonArrayOptionArgs(["--output-tables", "nonsense", "mytask"])).toEqual([
      "--output-tables", "nonsense", "mytask",
    ])
  })

  test("the inline --opt=value form works the same way", () => {
    expect(coalesceJsonArrayOptionArgs(['--output-tables=[{"n":', '1}]', "mytask"])).toEqual([
      '--output-tables=[{"n":1}]', "mytask",
    ])
  })

  test("unrelated arguments pass through untouched", () => {
    const args = ["sql", "select 1", "--format", "json"]
    expect(coalesceJsonArrayOptionArgs(args)).toEqual(args)
  })
})

describe("the last-resort envelope does not swallow the legitimate sentinels", () => {
  test("a bare command group still renders help and exits 0", () => {
    // The group threw SubcommandHelpShown with exit 0 — reporting that as
    // INTERNAL_ERROR is exactly what the net must not do.
    const r = run(["mcp"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("Commands:")
    expect(r.stdout).not.toContain("INTERNAL_ERROR")
  }, SLOW_SPAWN)

  test("an error the command already reported is not reported twice", () => {
    // handledError() prints the envelope and throws HandledCliError.
    const r = run(["sql", "--file", "/nonexistent.sql"])
    expect(r.stdout.split("\n")).toHaveLength(1)
    expect(r.stdout).not.toContain("INTERNAL_ERROR")
  })

  test("--debug adds the stack on stderr, and only then", () => {
    const home = makeHome(`default_profile = "bad"

[profiles.bad]
instance = "i"
service = "api.invalid.example.com"
workspace = "w"
pat = "t"
auth_type = "passwrod"
`)
    const plain = run(["status", "--instance", "other"], {}, home)
    expect(hasStackTrace(plain.stderr)).toBe(false)

    const debug = run(["status", "--instance", "other", "--debug"], {}, home)
    expect(errorOf(debug.stdout).code).toBe("INVALID_AUTH_TYPE")
    expect(debug.stderr).toContain("resolveConnectionConfig")
  })
})

describe("the numeric guard's edges", () => {
  test("a negative value is a number, not junk", () => {
    const r = run(["task", "cron-preview", "0 0 * * *", "--count", "-3"])
    expect(errorOf(r.stdout).code).not.toBe("USAGE_ERROR")
  }, SLOW_SPAWN)

  test("a fractional value is a number, not junk", () => {
    const r = run(["task", "cron-preview", "0 0 * * *", "--count", "2.5"])
    expect(errorOf(r.stdout).code).not.toBe("USAGE_ERROR")
  }, SLOW_SPAWN)

  test("one bad element rejects a repeatable numeric option", () => {
    const r = run([
      "analytics-agent", "knowledge", "update", "1",
      "--domain-id", "7", "--domain-id", "seven",
    ])
    expect(errorOf(r.stdout).code).toBe("USAGE_ERROR")
    expect(errorOf(r.stdout).message).toContain("--domain-id")
  }, SLOW_SPAWN)

  test("all-numeric elements pass through as a list", () => {
    const r = run([
      "analytics-agent", "knowledge", "update", "1",
      "--domain-id", "7", "--domain-id", "8",
    ])
    expect(errorOf(r.stdout).code).not.toBe("USAGE_ERROR")
  }, SLOW_SPAWN)
})

describe("sql input priority, in the order --help documents", () => {
  test("-e/--execute wins over --file", () => {
    const r = run(["sql", "-e", "select 1", "--file", "/nonexistent.sql"])
    expect(errorOf(r.stdout).code).not.toBe("FILE_READ_ERROR")
  }, SLOW_SPAWN)

  test("--file is still read when it is the only input", () => {
    const r = run(["sql", "--file", "/nonexistent.sql"])
    expect(errorOf(r.stdout).code).toBe("FILE_READ_ERROR")
  })

  test("a statement starting with a dash goes through `--`", () => {
    const r = run(["sql", "--", "-- a comment\nselect 1"])
    expect(errorOf(r.stdout).message ?? "").not.toContain("No SQL statements found")
  }, SLOW_SPAWN)
})

describe("the onboarding gates deliberately keep their structured payload", () => {
  // Unlike every other error, NO_PROFILE / NO_LLM_CONFIGURED carry next_steps and
  // register_urls — guidance a one-line ERROR row would drop. This is the documented
  // exception to "usage errors follow the chosen format"; pinning it here so the
  // exception is a decision rather than something that quietly drifts either way.
  const emptyHome = mkdtempSync(join(tmpdir(), "cz-argsafe-empty-"))

  test("NO_PROFILE stays JSON even under --format text", () => {
    const r = run(["status", "--format", "text"], {}, emptyHome)
    expect(r.exitCode).toBe(1)
    const parsed = JSON.parse(r.stdout) as Record<string, any>
    expect(parsed.error.code).toBe("NO_PROFILE")
    expect(Array.isArray(parsed.error.next_steps)).toBe(true)
  })

  test("NO_LLM_CONFIGURED stays JSON even under --format text", () => {
    const r = run(["agent", "run", "--format", "text", "hello"], {}, emptyHome)
    const parsed = JSON.parse(r.stdout) as Record<string, any>
    expect(parsed.error.code).toBe("NO_LLM_CONFIGURED")
  }, SLOW_SPAWN)
})

describe("serve's logging flags are wired, not just declared", () => {
  // The flag surface is asserted through --help above; this covers the other half —
  // that a declared flag actually reaches the env var opencode reads. Kept as a unit
  // test because the alternative is booting a server to observe its log output.
  const ENV_KEYS = ["OPENCODE_PRINT_LOGS", "OPENCODE_LOG_LEVEL", "OPENCODE_PURE"] as const
  const saved = new Map<string, string | undefined>()

  beforeEach(async () => {
    for (const key of ENV_KEYS) {
      saved.set(key, process.env[key])
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const previous = saved.get(key)
      if (previous === undefined) delete process.env[key]
      else process.env[key] = previous
    }
  })

  test("--print-logs and --log-level reach opencode's env", async () => {
    const { applyServeLogFlags } = await import("../src/bootstrap/runtime.ts")
    applyServeLogFlags({ "print-logs": true, "log-level": "DEBUG" })
    expect(process.env.OPENCODE_PRINT_LOGS).toBe("1")
    expect(process.env.OPENCODE_LOG_LEVEL).toBe("DEBUG")
    expect(process.env.OPENCODE_PURE).toBeUndefined()
  })

  test("--pure reaches opencode's env", async () => {
    const { applyServeLogFlags } = await import("../src/bootstrap/runtime.ts")
    applyServeLogFlags({ pure: true })
    expect(process.env.OPENCODE_PURE).toBe("1")
  })

  test("absent flags set nothing", async () => {
    const { applyServeLogFlags } = await import("../src/bootstrap/runtime.ts")
    applyServeLogFlags({})
    for (const key of ENV_KEYS) expect(process.env[key]).toBeUndefined()
  })
})

describe("the agent path validates its own numeric flag", () => {
  // `--timeout` is cz's flag, so unlike the rest of the agent tree it is ours to get
  // right. Its check used to run past the LLM gate, so on a machine with no LLM
  // registered the bad value was never mentioned at all — the same masking the cz
  // command tree already forbids for NO_PROFILE.
  test("--timeout with junk is a usage error, not masked by the LLM gate", () => {
    const r = run(["agent", "run", "--timeout", "abc", "hello"])
    expect(r.exitCode).toBe(2)
    expect(errorOf(r.stdout).code).toBe("USAGE_ERROR")
    expect(errorOf(r.stdout).message).toContain("--timeout")
  }, SLOW_SPAWN)

  test("it follows the chosen format like any other usage error", () => {
    const r = run(["agent", "run", "--timeout", "0", "--format", "text", "hello"])
    expect(r.stdout).toBe("ERROR USAGE_ERROR: --timeout must be a positive number of seconds")
  }, SLOW_SPAWN)

  test("a valid --timeout is not touched by the check", () => {
    const r = run(["agent", "run", "--timeout", "150", "hello"])
    expect(errorOf(r.stdout).code).not.toBe("USAGE_ERROR")
  }, SLOW_SPAWN)
})

describe("known sharp edges, pinned so they stay decisions", () => {
  // yargs-parser accepts only "true"/"false" as a boolean's inline value; anything
  // else is false. Deliberately NOT changed: it is uniform across the CLI, the
  // direction is fail-safe (`--dangerously-skip-permissions=1` reads as off), and
  // overriding it would create a second boolean dialect alongside `--no-x`.
  test("a boolean flag only accepts =true, and =1/=yes read as off", () => {
    expect(run(["profile", "list", "--show-secret=true", "--field", "pat"]).stdout).toBe("pat-token")
    for (const form of ["--show-secret=1", "--show-secret=yes", "--show-secret=maybe"]) {
      expect(run(["profile", "list", form, "--field", "pat"]).stdout).not.toBe("pat-token")
    }
  }, SLOW_SPAWN)

  // An option WITH a default swallows an empty value and falls back to that default;
  // one WITHOUT a default sees "" and fails its choices check. Both are yargs
  // semantics, and the empty-means-absent half matches what the connection layer
  // does with `--workspace ""`. Pinned because the two look inconsistent side by
  // side, and because a global "empty means absent" rule is NOT available: `ai-gateway
  // key create --add-to-llm ""` uses the empty string as a real value.
  test("--format with no value falls back to the default format", () => {
    const r = run(["auth", "list", "--format"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout.startsWith("{")).toBe(true)
  })

  test("--protocol with no value is rejected, because it has no default", () => {
    const r = run(["status", "--protocol"])
    expect(r.exitCode).toBe(2)
    expect(errorOf(r.stdout).message).toContain("protocol")
  })
})

describe("serve keeps the global flags the outer layer already consumed", () => {
  // `serve` is a RUNTIME_COMMAND: run-cli reads `--profile` off this same argv and
  // pins it, and re-inserts `--format` after the command word. Turning on .strict()
  // without declaring them rejected an invocation that works — `--profile` selects
  // the lakehouse the served agent connects as.
  function serveProbe(args: string[]): string {
    const log = join(mkdtempSync(join(tmpdir(), "cz-serve-")), "out.log")
    const child = spawnSync("bash", [
      "-c",
      `${BINARY} ${BINARY_ENTRY.join(" ")} serve ${args.join(" ")} > ${log} 2>&1 & pid=$!; sleep 8; kill -9 $pid 2>/dev/null; cat ${log}`,
    ], {
      cwd: import.meta.dir + "/..",
      encoding: "utf-8",
      env: { ...process.env, HOME: HOME, CLICKZETTA_TEST_HOME: HOME, NO_COLOR: "1" },
      timeout: 40_000,
    })
    return (child.stdout ?? "") + (child.stderr ?? "")
  }

  // Every cz global, not just the four this first went out with: run-cli reads the
  // connection ones off this same argv, so `serve --workspace ws1` works today.
  for (const flag of [
    ["--profile", "p1"], ["--format", "json"], ["--field", "x"], ["--debug"],
    ["--workspace", "ws1"], ["--instance", "i2"], ["--schema", "sc"], ["--vcluster", "vc"],
    ["--service", "svc"], ["--protocol", "http"], ["--pat", "tok"], ["--jdbc", "jdbc:x"],
    ["--username", "u"], ["--password", "w"], ["-p", "p1"],
  ]) {
    test(`${flag[0]} is accepted, not rejected by .strict()`, () => {
      const out = serveProbe(flag)
      expect(out).toContain("listening on http://")
      expect(out).not.toContain("Unknown argument")
    }, SLOW_SPAWN)
  }

  test("a real typo is still rejected, and no server starts", () => {
    const out = serveProbe(["--prot", "45999"])
    expect(out).toContain("Unknown argument: prot")
    expect(out).not.toContain("listening on http://")
  }, SLOW_SPAWN)
})

describe("auth list keeps its JSON contract", () => {
  const home = makeHome(`default_profile = "uat_0"

[oauth.uat]
expire_time_ms = 3600000
obtained_at = 1000000000000

[profiles.uat_0]
oauth = "uat"
`)

  test("the sessions list stays under data.sessions", () => {
    const payload = JSON.parse(run(["auth", "list", "--format", "json"], {}, home).stdout) as Record<string, any>
    expect(Array.isArray(payload.data.sessions)).toBe(true)
    expect(payload.data.active_profile).toBe("uat_0")
  })

  test("--field sessions still resolves", () => {
    const out = run(["auth", "list", "--field", "sessions"], {}, home).stdout
    expect(out.startsWith("[")).toBe(true)
    expect(out).toContain('"session":"uat"')
  })

  test("row formats still get one row per session", () => {
    expect(run(["auth", "list", "--format", "text"], {}, home).stdout.split("\t")[0]).toBe("uat")
  })
})

describe("a projected list never costs a command its verdict", () => {
  test("datasource check keeps `ready` in row formats", () => {
    // `checks` is a list, but `ready` is the answer; declaring the list would drop it.
    const r = run(["datasource", "check", "1", "--format", "csv"])
    // Unreachable host, so this only asserts the shape decision, not a real check.
    expect(errorOf(r.stdout).code ?? "").not.toBe("USAGE_ERROR")
  }, SLOW_SPAWN)
})

describe("telemetry: a value-less flag no longer claims the next token", () => {
  test("a boolean flag before a statement records the flag, not the statement", async () => {
    const { parseTrackingArgs } = await import("../src/telemetry.ts")
    const r = parseTrackingArgs(["sql", "--debug", "select * from customers where region = 'apac'"])
    expect(r.args.debug).toBe("true")
    expect(JSON.stringify(r.args)).not.toContain("customers")
  })

  test("the --no-x form counts as value-less too", async () => {
    const { parseTrackingArgs } = await import("../src/telemetry.ts")
    expect(parseTrackingArgs(["sql", "--no-limit", "select 1"]).args["no-limit"]).toBe("true")
  })

  test("a flag that does take a value is unaffected", async () => {
    const { parseTrackingArgs } = await import("../src/telemetry.ts")
    expect(parseTrackingArgs(["sql", "--timeout", "150", "select 1"]).args.timeout).toBe("150")
  })
})

describe("`--` operands stay scoped to the command that reads them", () => {
  test("sql -- <statement> works", () => {
    const r = run(["sql", "--", "select 1"])
    expect(errorOf(r.stdout).message ?? "").not.toContain("No SQL statements found")
  }, SLOW_SPAWN)

  test("the root parser's operand handling is unchanged for other commands", () => {
    // Reading `_` in sql rather than turning on yargs' populate-- keeps `argv["--"]`
    // out of every other command's parse.
    const r = run(["profile", "detail", "p1", "--field", "name"])
    expect(r.stdout).toBe("p1")
  })
})

describe("status reports one payload shape for every outcome", () => {
  test("the failure payload still carries workspace and schema", () => {
    const payload = JSON.parse(run(["status", "--format", "json"]).stdout) as Record<string, any>
    expect(payload.data.connected).toBe(false)
    expect(payload.data).toHaveProperty("workspace")
    expect(payload.data).toHaveProperty("schema")
  }, SLOW_SPAWN)
})

describe("second-round review fixes", () => {
  test("a credential-shaped value stays out of _positional behind a value-less flag", async () => {
    // The value-less skip must not disable the check on the VALUE: `Cookie=…` is a
    // credential whatever flag precedes it.
    const { parseTrackingArgs } = await import("../src/telemetry.ts")
    const r = parseTrackingArgs(["profile", "create", "p", "--debug", "Cookie=abc123"])
    expect(JSON.stringify(r)).not.toContain("abc123")
  })

  test("-a keeps taking its value, since mcp init declares it as --client", async () => {
    const { parseTrackingArgs } = await import("../src/telemetry.ts")
    expect(parseTrackingArgs(["mcp", "init", "-a", "claude"]).args.a).toBe("claude")
  })

  test("a typed --profile is reported on the agent path too", () => {
    // The guard used to be keyed on the command connecting, and agent commands are not
    // in PROFILE_REQUIRED_COMMANDS — so this said nothing on either stream, applied no
    // connection env, and pinned the missing name anyway.
    const r = run(["agent", "run", "--profile", "ghost", "hello"])
    expect(errorOf(r.stdout).code).toBe("PROFILE_NOT_FOUND")
  }, SLOW_SPAWN)

  test("an env-only agent invocation is not gated on the profile existing", () => {
    // The gate covers the commands the NO_PROFILE gate covers, and no more: a
    // CZ_PROFILE exported as a label with credentials in CZ_* used to keep working.
    const r = run(["agent", "llm", "show"], { CZ_PROFILE: "ghost" })
    expect(errorOf(r.stdout).code).not.toBe("PROFILE_NOT_FOUND")
  }, SLOW_SPAWN)

  test("an unhandled runtime error does not widen the error vocabulary", () => {
    // ENOENT & co. are libuv codes; only our own InterfaceError codes are promoted.
    const r = run(["sql", "--file", "/nonexistent.sql"])
    expect(errorOf(r.stdout).code).toBe("FILE_READ_ERROR")
    expect(r.stdout).not.toContain("ENOENT\"")
  })

  test("our own usage errors do not collect a did-you-mean for a valid flag", () => {
    const r = run(["task", "cron-preview", "0 0 * * *", "--count", "abc"])
    expect(errorOf(r.stdout).message).toBe("Invalid number value for: --count")
    expect(errorOf(r.stdout).did_you_mean).toBeUndefined()
  })

  test("Ctrl-C's envelope follows the format like every other failure", async () => {
    // main.ts and sql.ts both render ABORTED; they now use the same renderer.
    const main = await Bun.file(import.meta.dir + "/../src/main.ts").text()
    expect(main).toContain("renderErrorOutput({ error: { code: \"ABORTED\"")
  })
})
