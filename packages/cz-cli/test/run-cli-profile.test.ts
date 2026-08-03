import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { classifyCliArgs } from "../src/run-cli"

// Upstream opencode binds `-p` to `--password` (basic auth for a headless server)
// on run/attach/providers — a concept cz-cli does not expose. Left alone, the cz
// global `-p, --profile` collided with it on the agent runtime path: the value was
// parsed as a server password, --profile stayed unset, and the runtime middleware
// reset CZ_* back to default_profile, silently targeting the WRONG lakehouse.
// classifyCliArgs canonicalizes `-p` to `--profile` before any parser runs.
// A re-baseline that reintroduces the collision must fail here.
describe("-p short flag canonicalization (upstream --password collision)", () => {
  const cases: Array<[string, string[], string[]]> = [
    ["agent run", ["agent", "run", "hi", "-p", "staging"], ["agent", "run", "hi", "--profile", "staging"]],
    ["bare agent", ["agent", "-p", "staging"], ["agent", "--profile", "staging"]],
    ["agent subcommand", ["agent", "session", "list", "-p", "x"], ["agent", "session", "list", "--profile", "x"]],
    ["top-level run", ["run", "hi", "-p", "staging"], ["run", "hi", "--profile", "staging"]],
    ["-p= form", ["run", "hi", "-p=staging"], ["run", "hi", "--profile=staging"]],
    ["native command", ["sql", "SELECT 1", "-p", "staging"], ["sql", "SELECT 1", "--profile", "staging"]],
  ]

  for (const [name, input, expected] of cases) {
    test(`rewrites -p to --profile: ${name}`, () => {
      expect(classifyCliArgs(input).runtimeArgs).toEqual(expected)
    })
  }

  // -v is --version (boolean) in BOTH parser trees now. It used to be --vcluster
  // at the top level and --version under `agent`, so `agent -v myvc session list`
  // printed the version and silently dropped the command. The scanner must treat
  // -v as value-less, or it swallows the following token as a vcluster name.
  test("-v takes no value and is not read as --vcluster", () => {
    const result = classifyCliArgs(["agent", "-v", "session", "list"])
    expect(result.command).toBe("agent")
    expect(result.subcommand).toBe("session")
  })

  test("leaves args after -- untouched", () => {
    const result = classifyCliArgs(["agent", "run", "hi", "--", "-p", "raw"])
    expect(result.runtimeArgs).toEqual(["agent", "run", "hi", "--", "-p", "raw"])
  })

  test("-p selects the profile without being consumed as a subcommand", () => {
    const result = classifyCliArgs(["agent", "-p", "staging", "session", "list"])
    expect(result.command).toBe("agent")
    expect(result.subcommand).toBe("session")
    expect(result.shouldDelegateToAgentRuntime).toBe(true)
  })
})

// withNetworkOptions() (packages/opencode/src/cli/network.ts) mixes --port/
// --hostname/--mdns-domain/--cors into the $0 TUI command, so they legally appear
// before any `agent` subcommand — right where the pre-yargs scanner looks. It did
// not know they take a value, so it read the VALUE as the subcommand: bare
// `agent --port 8080` missed AGENT_RUNTIME_SUBCOMMANDS, never delegated, and
// printed the `agent` group help with exit 0 — no server, no diagnostic. The same
// hole covered the $0 TUI's --prompt/--agent/--replay-limit and the agent-level
// --log-level. A re-baseline that adds a value-taking option here must fail here.
describe("upstream value-taking flags before an agent subcommand", () => {
  const VALUE_FLAGS: Array<[string, string]> = [
    ["--port", "8080"],
    ["--hostname", "0.0.0.0"],
    ["--mdns-domain", "x.local"],
    ["--cors", "https://a.com"],
    ["--prompt", "hi"],
    ["--agent", "build"],
    ["--replay-limit", "5"],
    ["--log-level", "DEBUG"],
  ]

  for (const [flag, value] of VALUE_FLAGS) {
    test(`bare agent ${flag} <value> delegates instead of printing help`, () => {
      const result = classifyCliArgs(["agent", flag, value])
      expect(result.command).toBe("agent")
      expect(result.subcommand).toBeUndefined()
      expect(result.shouldDelegateToAgentRuntime).toBe(true)
    })

    test(`agent ${flag} <value> run keeps run as the subcommand`, () => {
      const result = classifyCliArgs(["agent", flag, value, "run", "hi"])
      expect(result.subcommand).toBe("run")
      expect(result.shouldDelegateToAgentRuntime).toBe(true)
    })

    test(`agent ${flag}=<value> still delegates (equals form)`, () => {
      const result = classifyCliArgs(["agent", `${flag}=${value}`])
      expect(result.subcommand).toBeUndefined()
      expect(result.shouldDelegateToAgentRuntime).toBe(true)
    })

    test(`agent run ${flag} <value> is unaffected after the subcommand`, () => {
      const result = classifyCliArgs(["agent", "run", "hi", flag, value])
      expect(result.subcommand).toBe("run")
      expect(result.shouldDelegateToAgentRuntime).toBe(true)
    })
  }

  // The mirror-image mistake. --mdns is boolean upstream, so listing it as
  // value-taking would make the scanner swallow the following token: `agent --mdns
  // run hi` would resolve "hi" (or nothing) as the subcommand. Same reasoning keeps
  // --continue/--fork/--print-logs/--pure out of the set.
  const BOOLEAN_FLAGS = ["--mdns", "--fork", "--print-logs", "--pure"]
  for (const flag of BOOLEAN_FLAGS) {
    test(`${flag} is boolean and consumes no following token`, () => {
      expect(classifyCliArgs(["agent", flag]).subcommand).toBeUndefined()
      const withSub = classifyCliArgs(["agent", flag, "run", "hi"])
      expect(withSub.subcommand).toBe("run")
      expect(withSub.shouldDelegateToAgentRuntime).toBe(true)
    })
  }

  test("several value flags in a row still find the subcommand", () => {
    const result = classifyCliArgs(["agent", "--port", "8080", "--hostname", "0.0.0.0", "session", "list"])
    expect(result.subcommand).toBe("session")
    expect(result.shouldDelegateToAgentRuntime).toBe(true)
  })

  // Top-level `serve`/`run` are in RUNTIME_COMMANDS, so they delegate on the
  // command name alone and never consult the agent scanner. Nothing to add there.
  test("top-level serve/run delegate without scanning their flags", () => {
    expect(classifyCliArgs(["serve", "--port", "8080"]).shouldDelegateToAgentRuntime).toBe(true)
    expect(classifyCliArgs(["run", "hi", "--port", "8080"]).shouldDelegateToAgentRuntime).toBe(true)
  })

  test("network flags are not read as cz connection overrides", () => {
    const result = classifyCliArgs(["agent", "--port", "8080", "--profile", "staging"])
    expect(result.runtimeArgs).toEqual(["agent", "--port", "8080", "--profile", "staging"])
    expect(result.shouldDelegateToAgentRuntime).toBe(true)
  })

  // The behavioural tests above only cover the options that exist TODAY. This
  // reads network.ts directly so a re-baseline that adds a value-taking option
  // there fails here instead of shipping another silent exit 0. Source-reading
  // (not importing) because network.ts pulls in the config/Effect graph.
  test("UPSTREAM_NETWORK_VALUE_FLAGS covers every value-taking option in network.ts", () => {
    const src = readFileSync(
      join(import.meta.dir, "..", "..", "opencode", "src", "cli", "network.ts"),
      "utf-8",
    )
    const block = src.match(/const options = \{([\s\S]*?)\n\}/)
    expect(block).not.toBeNull()
    const valueTaking = [...block![1]!.matchAll(/^ {2}"?([a-z-]+)"?: \{([\s\S]*?)^ {2}\}/gm)]
      .filter(([, , body]) => !/type: "boolean"/.test(body!))
      .map(([, name]) => name)
      .sort()
    expect(valueTaking).toEqual(["cors", "hostname", "mdns-domain", "port"])
  })
})

describe("classifyCliArgs profile-aware agent routing", () => {
  test("keeps bare agent entry on the TUI path when --profile is provided", () => {
    const result = classifyCliArgs(["agent", "--profile", "staging"])
    expect(result.shouldDelegateToAgentRuntime).toBe(true)
    expect(result.runtimeArgs).toEqual(["agent", "--profile", "staging"])
  })

  test("keeps agent subcommands intact when --profile appears before them", () => {
    const result = classifyCliArgs(["agent", "--profile", "staging", "session", "list"])
    expect(result.shouldDelegateToAgentRuntime).toBe(true)
    expect(result.runtimeArgs).toEqual(["agent", "--profile", "staging", "session", "list"])
  })

  test("detects runtime delegation when global flags appear before agent", () => {
    const result = classifyCliArgs(["--format", "text", "agent", "run", "hello"])
    expect(result.shouldDelegateToAgentRuntime).toBe(true)
    expect(result.command).toBe("agent")
    expect(result.subcommand).toBe("run")
    expect(result.runtimeArgs).toEqual(["agent", "--format", "text", "run", "hello"])
  })
})
