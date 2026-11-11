import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { testEffect } from "./lib/effect"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: () => Effect.succeed({ id: ProjectV2.ID.global, directory: AbsolutePath.make("/project") }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const sessions = SessionV2.layer.pipe(
  Layer.provide(LocationServiceMap.layer),
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(projects),
  Layer.provide(SessionExecution.noopLayer),
)
const it = testEffect(
  Layer.mergeAll(
    Database.defaultLayer,
    EventV2.defaultLayer,
    projects,
    SessionProjector.defaultLayer,
    SessionStore.defaultLayer,
    SessionExecution.noopLayer,
    sessions,
  ),
)

const create = (session: SessionV2.Interface, directory: string) =>
  session.create({ location: Location.Ref.make({ directory: AbsolutePath.make(directory) }) })

describe("SessionV2.list subpath", () => {
  it.effect("limits project listings to the directory and its descendants (empty, \".\" and \"./\" mean the whole project)", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const root = yield* create(session, "/project")
      const a = yield* create(session, "/project/a")
      const nested = yield* create(session, "/project/a/b/c")
      const sibling = yield* create(session, "/project/b")
      const prefix = yield* create(session, "/project/ab")
      const wild = yield* create(session, "/project/a_c")
      const emoji = yield* create(session, "/project/😀")
      const emojiNested = yield* create(session, "/project/😀/x")
      const cjk = yield* create(session, "/project/目录")
      const cjkNested = yield* create(session, "/project/目录/子")
      const upper = yield* create(session, "/project/A/x")
      const list = (subpath?: string) =>
        session
          .list({ project: ProjectV2.ID.global, subpath: subpath === undefined ? undefined : RelativePath.make(subpath) })
          .pipe(Effect.map((items) => items.map((item) => item.id).toSorted()))
      const ids = (...items: { id: SessionV2.ID }[]) => items.map((item) => item.id).toSorted()

      expect(yield* list()).toEqual(ids(root, a, nested, sibling, prefix, wild, upper, emoji, emojiNested, cjk, cjkNested))
      expect(yield* list("")).toEqual(ids(root, a, nested, sibling, prefix, wild, upper, emoji, emojiNested, cjk, cjkNested))
      expect(yield* list(".")).toEqual(ids(root, a, nested, sibling, prefix, wild, upper, emoji, emojiNested, cjk, cjkNested))
      expect(yield* list("./")).toEqual(ids(root, a, nested, sibling, prefix, wild, upper, emoji, emojiNested, cjk, cjkNested))
      expect(yield* list("A")).toEqual(ids(upper))
      expect(yield* list("😀")).toEqual(ids(emoji, emojiNested))
      expect(yield* list("目录")).toEqual(ids(cjk, cjkNested))
      expect(yield* list("a")).toEqual(ids(a, nested))
      expect(yield* list("a/")).toEqual(ids(a, nested))
      expect(yield* list("./a")).toEqual(ids(a, nested))
      expect(yield* list("a/b")).toEqual(ids(nested))
      expect(yield* list("a_c")).toEqual(ids(wild))
      expect(yield* list("a%")).toEqual([])
      expect(yield* list("missing")).toEqual([])
    }),
  )

  it.effect("applies the subpath before the limit", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const a = yield* create(session, "/project/a")
      yield* create(session, "/project/b")
      yield* create(session, "/project/b")
      const result = yield* session.list({
        project: ProjectV2.ID.global,
        subpath: RelativePath.make("a"),
        limit: 1,
      })
      expect(result.map((item) => item.id)).toEqual([a.id])
    }),
  )
})
