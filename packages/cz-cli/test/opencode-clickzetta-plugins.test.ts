import { describe, expect, test, beforeAll, afterAll, afterEach, beforeEach } from "bun:test"
import { ClickzettaSystemPromptPlugin } from "../src/opencode-plugin/system-prompt.js"
import { ClickzettaProfileReminderPlugin } from "../src/opencode-plugin/profile-reminder.js"

const hadPrompt = process.env.CLICKZETTA_AGENT_SYSTEM_PROMPT
const hadProfile = process.env.CZ_PROFILE

beforeAll(() => {})
afterAll(() => {
  if (hadPrompt === undefined) delete process.env.CLICKZETTA_AGENT_SYSTEM_PROMPT
  else process.env.CLICKZETTA_AGENT_SYSTEM_PROMPT = hadPrompt
  if (hadProfile === undefined) delete process.env.CZ_PROFILE
  else process.env.CZ_PROFILE = hadProfile
})

const prompt = "ClickZetta system prompt from cz-cli"
const model = { providerID: "clickzetta", api: { id: "qwen" } } as any

async function transformSystem(system: string[]) {
  process.env.CLICKZETTA_AGENT_SYSTEM_PROMPT = prompt
  const hooks = await ClickzettaSystemPromptPlugin({} as any)
  await hooks["experimental.chat.system.transform"]!({ model }, { system })
  return system
}

function userMsg(id: string) {
  return { info: { id, role: "user", sessionID: "ses_1" }, parts: [] as any[] }
}

function assistantMsg(id: string) {
  return { info: { id, role: "assistant", sessionID: "ses_1" }, parts: [] as any[] }
}

async function transformMessages(messages: any[]) {
  const hooks = await ClickzettaProfileReminderPlugin({} as any)
  await hooks["experimental.chat.messages.transform"]!({}, { messages } as any)
  return messages
}

describe("clickzetta system-prompt plugin", () => {
  test("appends the cz-cli inner prompt to the system array", async () => {
    const system = await transformSystem(["BASE PROMPT"])
    expect(system[0]).toBe("BASE PROMPT")
    expect(system).toContain(prompt)
    expect(system.join("\n")).toContain("ClickZetta")
  })

  test("is idempotent — does not double-inject", async () => {
    const system = ["BASE"]
    await transformSystem(system)
    await transformSystem(system)
    expect(system.filter((item) => item === prompt).length).toBe(1)
  })
})

describe("clickzetta profile-reminder plugin", () => {
  beforeEach(() => {
    process.env.CZ_PROFILE = "staging"
  })

  afterEach(() => {
    if (hadProfile === undefined) delete process.env.CZ_PROFILE
    else process.env.CZ_PROFILE = hadProfile
  })

  test("appends an Active ClickZetta profile reminder to the last user message", async () => {
    const messages = [userMsg("msg_1"), assistantMsg("msg_2"), userMsg("msg_3")]
    await transformMessages(messages)
    expect(messages[0].parts.length).toBe(0)
    expect(messages[2].parts.length).toBe(1)
    const part = messages[2].parts[0]
    expect(part.type).toBe("text")
    expect(part.text).toContain("Active ClickZetta profile: staging")
    expect(part.synthetic).toBe(true)
    expect(part.messageID).toBe("msg_3")
  })

  test("is idempotent — does not stack duplicate reminders", async () => {
    const messages = [userMsg("msg_1")]
    await transformMessages(messages)
    await transformMessages(messages)
    expect(messages[0].parts.filter((part: any) => part.text?.includes("Active ClickZetta profile")).length).toBe(1)
  })

  test("no user message → no-op", async () => {
    const messages = [assistantMsg("msg_1")]
    await transformMessages(messages)
    expect(messages[0].parts.length).toBe(0)
  })
})
