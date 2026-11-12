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

test("a PR whose only new activity is a bot comment wakes nobody", async () => {
  const lines: string[] = []
  const time = clock(Date.parse("2026-11-11T10:00:00Z"))
  // GitHub lists the PR row with its human author and a fresh updated_at after AI review comments.
  const pr = {
    id: 40,
    number: 40,
    user: human,
    created_at: "2026-11-01T08:00:00Z",
    updated_at: "2026-11-11T10:00:20Z",
    pull_request: {},
    html_url: "https://github.com/o/r/pull/40",
  }
  const review = { id: 41, user: bot, updated_at: "2026-11-11T10:00:20Z", issue_url: "x/issues/40", html_url: "https://github.com/o/r/pull/40#c41" }
  const opened = { ...pr, id: 42, number: 42, created_at: "2026-11-11T10:00:40Z", html_url: "https://github.com/o/r/pull/42" }
  const run = fake({ "r/issues": [[pr, opened]], "issues/comments": [[review]] })
  await watchGithub({ repository: "o/r" }, { seconds: 60, run, emit: (l) => lines.push(l), ...time })
  expect(lines.filter((l) => l.startsWith("github "))).toEqual([
    "github pull-request #42 by alice: https://github.com/o/r/pull/42",
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
  const issuePolls = { count: 0 }
  const ok = fake({}, calls)
  const run: IntakeRunner = async (argv) => {
    const url = String(argv.at(-1))
    if (url.includes("/issues?")) issuePolls.count++
    // The first round succeeds, the second fails; every other round succeeds.
    if (url.includes("/issues?") && issuePolls.count === 2) return { stdout: "", stderr: "timeout", exitCode: 1 }
    return ok(argv)
  }
  await watchGithub({ repository: "o/r" }, { seconds: 400, run, emit: (l) => lines.push(l), ...time })
  expect(lines[0]).toBe("github watch error (1): gh api failed (exit 1)")
  // Recorded calls are the successful ones: at +0, then the retry at +180 (60s, then 120s of
  // backoff), then +240, +300, +360. The retry asks for the window the failed round asked for.
  const sinces = calls.filter((c) => c.includes("/issues?")).map((c) => new URL(`https://x${c}`).searchParams.get("since"))
  expect(sinces.slice(0, 2)).toEqual(["2026-11-11T09:59:00.000Z", "2026-11-11T09:59:00.000Z"])
  expect(sinces).toHaveLength(5)
})

test("the watcher stops at its deadline", async () => {
  const time = clock(Date.parse("2026-11-11T10:00:00Z"))
  const calls: string[] = []
  const result = await watchGithub({ repository: "o/r" }, { seconds: 600, run: fake({}, calls), emit: () => {}, ...time })
  expect(calls.filter((c) => c.includes("/issues?"))).toHaveLength(10)
  expect(result.seen).toBe(0)
})
