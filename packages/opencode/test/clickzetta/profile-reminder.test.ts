import { describe, expect, test, afterEach, beforeEach, beforeAll, afterAll } from "bun:test"
import { ClickzettaProfileReminderPlugin } from "../../src/clickzetta/plugin/profile-reminder"
import { markClickzettaRuntime } from "../../src/clickzetta/runtime"

// Scope the cz runtime marker to this file (see system-prompt.test.ts note).
const hadRuntime = process.env.CLICKZETTA_RUNTIME
beforeAll(() => markClickzettaRuntime())
afterAll(() => {
  if (hadRuntime === undefined) delete process.env.CLICKZETTA_RUNTIME
  else process.env.CLICKZETTA_RUNTIME = hadRuntime
})

// Profile-label reminder is injected via the real experimental.chat.messages.transform
// hook (upstream prompt.ts stays pure). resolveCurrentProfileLabel reads CZ_PROFILE
// first, so we can drive the label deterministically.

const originalProfile = process.env.CZ_PROFILE

beforeEach(() => {
  process.env.CZ_PROFILE = "staging"
})
afterEach(() => {
  if (originalProfile === undefined) delete process.env.CZ_PROFILE
  else process.env.CZ_PROFILE = originalProfile
})

function userMsg(id: string) {
  return { info: { id, role: "user", sessionID: "ses_1" }, parts: [] as any[] }
}
function assistantMsg(id: string) {
  return { info: { id, role: "assistant", sessionID: "ses_1" }, parts: [] as any[] }
}

async function transform(messages: any[]) {
  const hooks = await ClickzettaProfileReminderPlugin({} as any)
  await hooks["experimental.chat.messages.transform"]!({}, { messages } as any)
  return messages
}

describe("clickzetta profile-reminder plugin", () => {
  test("appends an Active ClickZetta profile reminder to the last user message", async () => {
    const msgs = [userMsg("msg_1"), assistantMsg("msg_2"), userMsg("msg_3")]
    await transform(msgs)
    // last user message is msg_3
    expect(msgs[0].parts.length).toBe(0)
    expect(msgs[2].parts.length).toBe(1)
    const part = msgs[2].parts[0]
    expect(part.type).toBe("text")
    expect(part.text).toContain("Active ClickZetta profile: staging")
    expect(part.synthetic).toBe(true)
    expect(part.messageID).toBe("msg_3")
  })

  test("is idempotent — does not stack duplicate reminders", async () => {
    const msgs = [userMsg("msg_1")]
    await transform(msgs)
    await transform(msgs)
    const reminders = msgs[0].parts.filter((p: any) => p.text?.includes("Active ClickZetta profile"))
    expect(reminders.length).toBe(1)
  })

  test("no user message → no-op", async () => {
    const msgs = [assistantMsg("msg_1")]
    await transform(msgs)
    expect(msgs[0].parts.length).toBe(0)
  })
})
