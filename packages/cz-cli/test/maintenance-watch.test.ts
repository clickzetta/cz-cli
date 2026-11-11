import { expect, test } from "bun:test"
import type { IntakeRunner } from "../../../scripts/maintenance/intake"
import { isBotAuthor } from "../../../scripts/maintenance/intake"
import { watchGithub } from "../../../scripts/maintenance/watch"

const human = { login: "alice", type: "User" }
const bot = { login: "github-actions[bot]", type: "Bot" }

function clock(start: number) {
  const state = { now: start }
  return {
    now: () => state.now,
    sleep: async (ms: number) => {
      state.now += ms
    },
  }
}

function fake(pages: Record<string, Record<string, unknown>[][]>, calls: string[] = []): IntakeRunner {
  const served: Record<string, number> = {}
  return async (argv) => {
    const url = new URL(`https://api.github.com/${argv.at(-1)}`)
    calls.push(url.pathname + url.search)
    const key = url.pathname.split("/").slice(-2).join("/")
    const index = served[key] ?? 0
    served[key] = index + 1
    return { stdout: JSON.stringify(pages[key]?.[index] ?? []), stderr: "", exitCode: 0 }
  }
}

test("bot accounts are recognised by type or login suffix", () => {
  expect(isBotAuthor(bot)).toBe(true)
  expect(isBotAuthor({ login: "claude[bot]", type: "User" })).toBe(true)
  expect(isBotAuthor(human)).toBe(false)
  expect(isBotAuthor(undefined)).toBe(false)
})

test("the watcher announces each new human event once and ignores AI review", async () => {
  const lines: string[] = []
  const time = clock(Date.parse("2026-11-11T10:00:00Z"))
  const comment = {
    id: 7,
    updated_at: "2026-11-11T10:00:30Z",
    user: human,
    issue_url: "https://api.github.com/repos/o/r/issues/12",
    html_url: "https://github.com/o/r/pull/12#issuecomment-7",
  }
  const review = { ...comment, id: 8, user: bot, html_url: "https://github.com/o/r/pull/12#issuecomment-8" }
  const inline = {
    id: 9,
    updated_at: "2026-11-11T10:01:10Z",
    user: human,
    pull_request_review_id: 3,
    html_url: "https://github.com/o/r/pull/12#discussion_r9",
  }
  const run = fake({
    "issues/comments": [[comment, review], [comment, review]],
    "pulls/comments": [[], [inline]],
  })
  await watchGithub({ repository: "o/r" }, { seconds: 120, intervalSeconds: 60, run, emit: (l) => lines.push(l), ...time })
  expect(lines).toEqual([
    "github comment #12 by alice: https://github.com/o/r/pull/12#issuecomment-7",
    "github review-comment #12 by alice: https://github.com/o/r/pull/12#discussion_r9",
    "github watch ended; start a new watcher before the next round",
  ])
})

test("an edited comment is announced again", async () => {
  const lines: string[] = []
  const time = clock(Date.parse("2026-11-11T10:00:00Z"))
  const base = { id: 7, user: human, issue_url: "x/issues/5", html_url: "https://github.com/o/r/issues/5#c7" }
  const run = fake({
    "issues/comments": [[{ ...base, updated_at: "2026-11-11T10:00:10Z" }], [{ ...base, updated_at: "2026-11-11T10:01:20Z" }]],
  })
  await watchGithub({ repository: "o/r" }, { seconds: 120, run, emit: (l) => lines.push(l), ...time })
  expect(lines.filter((l) => l.startsWith("github comment"))).toHaveLength(2)
})

test("a failed poll is reported, keeps the window, and backs off", async () => {
  const lines: string[] = []
  const time = clock(Date.parse("2026-11-11T10:00:00Z"))
  const calls: string[] = []
  const state = { first: true }
  const ok = fake({}, calls)
  const run: IntakeRunner = async (argv) => {
    if (state.first) {
      state.first = false
      return { stdout: "", stderr: "timeout", exitCode: 1 }
    }
    return ok(argv)
  }
  await watchGithub({ repository: "o/r" }, { seconds: 300, run, emit: (l) => lines.push(l), ...time })
  expect(lines[0]).toBe("github watch error (1): gh api failed (exit 1)")
  // The retry asks for the same window as the failed attempt, not a later one.
  const sinces = calls.filter((c) => c.includes("/issues?")).map((c) => new URL(`https://x${c}`).searchParams.get("since"))
  expect(sinces[0]).toBe("2026-11-11T09:59:00.000Z")
  // Backoff: after the failure the watcher waits 120s, not 60s, so the recorded polls land at
  // +120, +180 and +240 instead of +60, +120, +180 and +240.
  expect(sinces).toHaveLength(3)
})

test("the watcher stops at its deadline", async () => {
  const time = clock(Date.parse("2026-11-11T10:00:00Z"))
  const calls: string[] = []
  const result = await watchGithub({ repository: "o/r" }, { seconds: 600, run: fake({}, calls), emit: () => {}, ...time })
  expect(calls.filter((c) => c.includes("/issues?"))).toHaveLength(10)
  expect(result.seen).toBe(0)
})
