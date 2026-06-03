import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../../fixture/fixture"
import * as App from "../../../src/cli/cmd/tui/app"
import { Rpc } from "../../../src/util"
import { UI } from "../../../src/cli/ui"
import * as Timeout from "../../../src/util/timeout"
import * as Network from "../../../src/cli/network"
import * as Win32 from "../../../src/cli/cmd/tui/win32"
import { TuiConfig } from "../../../src/cli/cmd/tui/config/tui"

const stop = new Error("stop")
const seen = {
  tui: [] as string[],
}
const originalEnv = { ...process.env }

function setup() {
  // Intentionally avoid mock.module() here: Bun keeps module overrides in cache
  // and mock.restore() does not reset mock.module values. If this switches back
  // to module mocks, later suites can see mocked @/config/tui and fail (e.g.
  // plugin-loader tests expecting real TuiConfig.waitForDependencies). See:
  // https://github.com/oven-sh/bun/issues/7823 and #12823.
  spyOn(App, "tui").mockImplementation(async (input) => {
    if (input.directory) seen.tui.push(input.directory)
    throw stop
  })
  spyOn(Rpc, "client").mockImplementation(() => ({
    call: async () => ({ url: "http://127.0.0.1" }) as never,
    on: () => () => {},
  }))
  spyOn(UI, "error").mockImplementation(() => {})
  spyOn(Timeout, "withTimeout").mockImplementation((input) => input)
  spyOn(Network, "resolveNetworkOptions").mockResolvedValue({
    mdns: false,
    port: 0,
    hostname: "127.0.0.1",
    mdnsDomain: "opencode.local",
    cors: [],
  })
  spyOn(Win32, "win32DisableProcessedInput").mockImplementation(() => {})
  spyOn(Win32, "win32InstallCtrlCGuard").mockReturnValue(undefined)
}

describe("tui thread", () => {
  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    mock.restore()
    process.env = { ...originalEnv }
  })

  async function call(project?: string, profile?: string) {
    const { TuiThreadCommand } = await import("../../../src/cli/cmd/tui/thread")
    const args: Parameters<NonNullable<typeof TuiThreadCommand.handler>>[0] = {
      _: [],
      $0: "opencode",
      p: profile,
      project,
      prompt: "hi",
      model: undefined,
      agent: undefined,
      session: undefined,
      continue: false,
      fork: false,
      dir: undefined,
      profile,
      port: 0,
      hostname: "127.0.0.1",
      mdns: false,
      "mdns-domain": "opencode.local",
      mdnsDomain: "opencode.local",
      cors: [],
    }
    return TuiThreadCommand.handler(args)
  }

  async function check(project?: string, profile?: string) {
    setup()
    await using tmp = await tmpdir({ git: true })
    const cwd = process.cwd()
    const pwd = process.env.PWD
    const worker = globalThis.Worker
    const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
    const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")
    const link = path.join(path.dirname(tmp.path), path.basename(tmp.path) + "-link")
    const type = process.platform === "win32" ? "junction" : "dir"
    seen.tui.length = 0
    await fs.symlink(tmp.path, link, type)
    await fs.mkdir(path.join(tmp.path, ".clickzetta"), { recursive: true })
    await fs.writeFile(
      path.join(tmp.path, ".clickzetta", "profiles.toml"),
      'default_profile = "default"\n\n[profiles.czcli]\nusername = "alice"\npassword = "secret"\nservice = "example.clickzetta.com"\nprotocol = "https"\ninstance = "workspace"\nworkspace = "quick_start"\nschema = "public"\nvcluster = "DEFAULT"\n',
    )

    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    })
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    })
    globalThis.Worker = class extends EventTarget {
      onerror = null
      onmessage = null
      onmessageerror = null
      postMessage() {}
      terminate() {}
    } as unknown as typeof Worker

    try {
      process.chdir(tmp.path)
      process.env.PWD = link
      process.env.CLICKZETTA_TEST_HOME = tmp.path
      await expect(call(project, profile)).rejects.toBe(stop)
      expect(seen.tui[0]).toBe(tmp.path)
    } finally {
      process.chdir(cwd)
      if (pwd === undefined) delete process.env.PWD
      else process.env.PWD = pwd
      if (stdinTty) Object.defineProperty(process.stdin, "isTTY", stdinTty)
      else delete (process.stdin as { isTTY?: boolean }).isTTY
      if (stdoutTty) Object.defineProperty(process.stdout, "isTTY", stdoutTty)
      else delete (process.stdout as { isTTY?: boolean }).isTTY
      globalThis.Worker = worker
      await fs.rm(link, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  test("uses the real cwd when PWD points at a symlink", async () => {
    await check()
  })

  test("uses the real cwd after resolving a relative project from PWD", async () => {
    await check(".")
  })

  test("accepts --profile on the bare TUI entry and expands profile env", async () => {
    await check(undefined, "czcli")
    expect(process.env.CZ_PROFILE).toBe("czcli")
    expect(process.env.CZ_USERNAME).toBe("alice")
    expect(process.env.CZ_PASSWORD).toBe("secret")
    expect(process.env.CZ_SERVICE).toBe("example.clickzetta.com")
    expect(process.env.CZ_WORKSPACE).toBe("quick_start")
  })

  test("refuses to launch the TUI when stdout is not a TTY", async () => {
    setup()
    const error = spyOn(UI, "error").mockImplementation(() => {})
    const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")
    const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
    const exitCode = process.exitCode
    seen.tui.length = 0

    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: false,
    })
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    })

    try {
      await expect(call()).resolves.toBeUndefined()
      expect(process.exitCode).toBe(1)
      expect(seen.tui).toHaveLength(0)
      expect(error).toHaveBeenCalledWith('The interactive TUI requires a terminal. For non-interactive use, run: cz-cli agent run "<prompt>"')
    } finally {
      process.exitCode = exitCode
      if (stdoutTty) Object.defineProperty(process.stdout, "isTTY", stdoutTty)
      else delete (process.stdout as { isTTY?: boolean }).isTTY
      if (stdinTty) Object.defineProperty(process.stdin, "isTTY", stdinTty)
      else delete (process.stdin as { isTTY?: boolean }).isTTY
    }
  })
})
