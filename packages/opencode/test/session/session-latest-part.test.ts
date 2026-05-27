import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session as SessionNs } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { Log } from "../../src/util"

const root = path.join(__dirname, "../..")
void Log.init({ print: false })

function run<A, E>(fx: Effect.Effect<A, E, SessionNs.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(SessionNs.defaultLayer)))
}

const svc = {
  create(input?: SessionNs.CreateInput) {
    return run(SessionNs.Service.use((s) => s.create(input)))
  },
  remove(id: SessionID) {
    return run(SessionNs.Service.use((s) => s.remove(id)))
  },
  updateMessage<T extends MessageV2.Info>(msg: T) {
    return run(SessionNs.Service.use((s) => s.updateMessage(msg)))
  },
  updatePart<T extends MessageV2.Part>(part: T) {
    return run(SessionNs.Service.use((s) => s.updatePart(part)))
  },
  latestPart(sessionID: SessionID) {
    return run(SessionNs.Service.use((s) => s.latestPart(sessionID)))
  },
  lastTextPart(sessionID: SessionID) {
    return run(SessionNs.Service.use((s) => s.lastTextPart(sessionID)))
  },
}

async function addUser(sessionID: SessionID) {
  const id = MessageID.ascending()
  await svc.updateMessage({
    id,
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "test",
    model: { providerID: "test", modelID: "test" },
    tools: {},
    mode: "",
  } as unknown as MessageV2.Info)
  return id
}

describe("Session.Service.latestPart", () => {
  test("returns the most recent part by time_created", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        const messageID = await addUser(session.id)

        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID,
          type: "text",
          text: "first",
        })
        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID,
          type: "text",
          text: "second",
        })
        const lastID = PartID.ascending()
        await svc.updatePart({
          id: lastID,
          sessionID: session.id,
          messageID,
          type: "text",
          text: "third",
        })

        const latest = await svc.latestPart(session.id)
        expect(latest).toBeDefined()
        expect(latest!.id).toBe(lastID)
        expect((latest as MessageV2.TextPart).text).toBe("third")

        await svc.remove(session.id)
      },
    })
  })

  test("returns undefined when session has no parts", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})

        const latest = await svc.latestPart(session.id)
        expect(latest).toBeUndefined()

        await svc.remove(session.id)
      },
    })
  })
})

describe("Session.Service.lastTextPart", () => {
  test("returns the most recent text part skipping non-text parts", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        const messageID = await addUser(session.id)

        // Insert a text part first
        const firstTextID = PartID.ascending()
        await svc.updatePart({
          id: firstTextID,
          sessionID: session.id,
          messageID,
          type: "text",
          text: "first text",
        })

        // Then a later text part
        const secondTextID = PartID.ascending()
        await svc.updatePart({
          id: secondTextID,
          sessionID: session.id,
          messageID,
          type: "text",
          text: "second text",
        })

        // Then a non-text part — this should NOT be returned by lastTextPart
        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID,
          type: "step-start",
        } as unknown as MessageV2.Part)

        const last = await svc.lastTextPart(session.id)
        expect(last).toBeDefined()
        expect(last!.id).toBe(secondTextID)
        expect(last!.type).toBe("text")
        expect(last!.text).toBe("second text")

        await svc.remove(session.id)
      },
    })
  })

  test("returns undefined when session has no text parts", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})

        const last = await svc.lastTextPart(session.id)
        expect(last).toBeUndefined()

        await svc.remove(session.id)
      },
    })
  })

  test("returns undefined when session has only non-text parts", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        const messageID = await addUser(session.id)

        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID,
          type: "step-start",
        } as unknown as MessageV2.Part)

        const last = await svc.lastTextPart(session.id)
        expect(last).toBeUndefined()

        await svc.remove(session.id)
      },
    })
  })

  test("lastTextPart skips non-text parts whose payload contains 'type:text' substring", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await svc.create({})
        const messageID = await addUser(session.id)

        // Real text part inserted first
        const textPartID = PartID.ascending()
        await svc.updatePart({
          id: textPartID,
          sessionID: session.id,
          messageID,
          type: "text",
          text: "real reply",
        } as MessageV2.TextPart)

        // Non-text part inserted later, but its JSON payload contains '"type":"text"' as a substring
        await svc.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID,
          type: "tool",
          callID: "call_decoy",
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "echo decoy" },
            output: '{"type":"text","text":"this is fake"}',
            title: "echo",
            metadata: {},
            time: { start: 1, end: 2 },
          },
        } as unknown as MessageV2.Part)

        const result = await svc.lastTextPart(session.id)
        // It should still find the real text part, not return undefined
        expect(result).toBeDefined()
        expect(result!.text).toBe("real reply")

        await svc.remove(session.id)
      },
    })
  })
})
