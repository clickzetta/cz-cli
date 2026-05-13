import { describe, expect, test } from "bun:test"
import { spawnSync } from "child_process"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

function run(
  args: string[],
  options: { home?: string; preload?: string } = {},
) {
  const home = options.home ?? mkdtempSync(join(tmpdir(), "opencode-llm-guidance-"))
  const bunArgs = options.preload ? ["--preload", options.preload, "./src/index.ts", ...args] : ["./src/index.ts", ...args]
  const result = spawnSync("bun", bunArgs, {
    cwd: join(import.meta.dir, "../../.."),
    encoding: "utf-8",
    env: {
      ...process.env,
      HOME: home,
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })

  return {
    home,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  }
}

function firstJson(output: string) {
  return JSON.parse(output.trim().split("\n")[0] ?? "{}") as Record<string, any>
}

describe("llm guidance", () => {
  test("agent llm help explains ClickZetta and OpenAI-style setup paths", () => {
    const result = run(["agent", "llm", "--help"])
    const help = result.stdout.replace(/\s+/g, " ")
    expect(result.exitCode).toBe(0)
    expect(help).toContain("cz-cli setup --credential <base64_string>")
    expect(help).toContain("openai-compatible")
    expect(help).toContain("cz-cli agent llm test [name]")
    expect(help).toContain("cz-cli setup --username <username> --password <password> --account-name <account_name>")
  })

  test("agent llm show works without a ClickZetta profile and returns onboarding guidance", () => {
    const result = run(["agent", "llm", "show"])
    expect(result.exitCode).toBe(0)
    expect(result.stderr).not.toContain("models.dev")
    expect(result.stderr).not.toContain("database migration")
    const json = firstJson(result.stdout)
    expect(json.data.active.kind).toBe("none")
    expect(json.data.onboarding.clickzetta_builtin).toEqual([
      "cz-cli setup --credential <base64_string>",
    ])
    expect(json.data.onboarding.external_llm).toEqual([
      "cz-cli agent llm add my-openai --provider openai --api-key <OPENAI_API_KEY> --use",
      "cz-cli agent llm add my-relay --provider openai-compatible --base-url https://your-gateway.example.com/v1 --api-key <API_KEY> --use",
    ])
  })

  test("agent llm add works without a ClickZetta profile", () => {
    const home = mkdtempSync(join(tmpdir(), "opencode-llm-add-"))
    const result = run(
      ["agent", "llm", "add", "my-openai", "--provider", "openai", "--api-key", "sk-test", "--use"],
      { home },
    )
    expect(result.exitCode).toBe(0)
    const json = firstJson(result.stdout)
    expect(json.data.name).toBe("my-openai")
    expect(json.data.used).toBe(true)

    const profilesPath = join(home, ".clickzetta", "profiles.toml")
    expect(existsSync(profilesPath)).toBe(true)
    const profiles = readFileSync(profilesPath, "utf-8")
    expect(profiles).toContain('default_llm = "my-openai"')
    expect(profiles).toContain('[llm.my-openai]')
  })

  test("agent llm add validates base-url for openai-compatible providers", () => {
    const result = run(["agent", "llm", "add", "relay", "--provider", "openai-compatible", "--api-key", "sk-test"])
    expect(result.exitCode).toBe(1)
    const json = firstJson(result.stdout)
    expect(json.error.code).toBe("PROVIDER_REQUIRES_BASE_URL")
  })

  test("agent llm test verifies a GPT-compatible endpoint", () => {
    const origin = "https://mock-openai.example"
    const preload = join(mkdtempSync(join(tmpdir(), "opencode-llm-preload-")), "mock-fetch.ts")
    writeFileSync(
      preload,
      `globalThis.fetch = async (input, init) => {
  const req = new Request(input, init)
  if (req.url === "${origin}/v1/models") {
    if (req.headers.get("authorization") !== "Bearer sk-live") {
      return Response.json({ error: { message: "bad key" } }, { status: 401 })
    }
    return Response.json({ data: [{ id: "gpt-5" }, { id: "gpt-4.1" }] })
  }
  return new Response("not found", { status: 404 })
}
`,
    )

    const home = mkdtempSync(join(tmpdir(), "opencode-llm-test-"))
    const add = run(
      [
        "agent",
        "llm",
        "add",
        "my-openai",
        "--provider",
        "openai",
        "--api-key",
        "sk-live",
        "--base-url",
        origin,
        "--use",
      ],
      { home },
    )
    expect(add.exitCode).toBe(0)

    const result = run(["agent", "llm", "test"], { home, preload })
    expect(result.exitCode).toBe(0)
    const json = firstJson(result.stdout)
    expect(json.data.name).toBe("my-openai")
    expect(json.data.provider).toBe("openai")
    expect(json.data.url).toBe(origin + "/v1/models")
    expect(json.data.sample_models).toEqual(["gpt-5", "gpt-4.1"])
  })

  test("agent llm test uses chat completions probe for clickzetta", () => {
    const origin = "https://mock-clickzetta.example"
    const preload = join(mkdtempSync(join(tmpdir(), "opencode-llm-preload-")), "mock-clickzetta-fetch.ts")
    writeFileSync(
      preload,
      `globalThis.fetch = async (input, init) => {
  const req = new Request(input, init)
  if (req.url === "${origin}/v1/chat/completions") {
    const body = await req.json()
    if (req.method !== "POST") return new Response("bad method", { status: 405 })
    if (req.headers.get("authorization") !== "Bearer ck-live") {
      return Response.json({ error: { message: "bad key" } }, { status: 401 })
    }
    if (!Array.isArray(body.messages)) {
      return Response.json({ error: { message: "missing messages" } }, { status: 400 })
    }
    return Response.json({ choices: [{ message: { content: "pong" } }] })
  }
  return new Response("not found", { status: 404 })
}
`,
    )

    const home = mkdtempSync(join(tmpdir(), "opencode-llm-clickzetta-test-"))
    const add = run(
      [
        "agent",
        "llm",
        "add",
        "clickzetta",
        "--provider",
        "clickzetta",
        "--api-key",
        "ck-live",
        "--base-url",
        origin,
        "--use",
      ],
      { home },
    )
    expect(add.exitCode).toBe(0)

    const result = run(["agent", "llm", "test"], { home, preload })
    expect(result.exitCode).toBe(0)
    const json = firstJson(result.stdout)
    expect(json.data.provider).toBe("clickzetta")
    expect(json.data.url).toBe(origin + "/v1/chat/completions")
    expect(json.data.probe).toBe("chat.completions")
    expect(json.data.sample_response).toBe("pong")
  })
})
