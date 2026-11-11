import type { Config } from "./state"
import type { IntakeRunner } from "./intake"
import { executeIntake, isBotAuthor } from "./intake"

// A wake-up signal, not a queue: it prints one line per new human event so the Worker's Monitor
// fires, and the Worker then runs `intake github`, which owns every cursor and receipt.
// GitHub cannot push to the maintenance host, so this polls the cheap `since` endpoints.
export async function watchGithub(
  config: Pick<Config, "repository">,
  options: {
    seconds: number
    intervalSeconds?: number
    run?: IntakeRunner
    emit?: (line: string) => void
    sleep?: (ms: number) => Promise<void>
    now?: () => number
  },
) {
  const run = options.run ?? executeIntake
  const emit = options.emit ?? ((line: string) => process.stdout.write(`${line}\n`))
  const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms))
  const now = options.now ?? Date.now
  const interval = (options.intervalSeconds ?? 60) * 1000
  const deadline = now() + options.seconds * 1000
  const base = `repos/${config.repository}`
  const seen = new Set<string>()
  // Overlap each window so an event stamped just before the previous poll is not lost.
  const state = { since: new Date(now() - interval).toISOString(), failures: 0 }
  while (now() < deadline) {
    const started = now()
    const events = await Promise.all([
      poll(run, `${base}/issues?state=all&sort=updated&direction=asc&since=${encodeURIComponent(state.since)}`),
      poll(run, `${base}/issues/comments?sort=updated&direction=asc&since=${encodeURIComponent(state.since)}`),
      poll(run, `${base}/pulls/comments?sort=updated&direction=asc&since=${encodeURIComponent(state.since)}`),
    ]).then(
      (pages) => pages.flat(),
      (error: unknown) => error as Error,
    )
    if (events instanceof Error) {
      state.failures++
      emit(`github watch error (${state.failures}): ${events.message}`)
    }
    if (!(events instanceof Error)) {
      state.failures = 0
      state.since = new Date(started - interval).toISOString()
      events
        .filter((event) => !isBotAuthor(event.user))
        .map((event) => ({ event, id: `${String(event.id)}:${String(event.updated_at)}` }))
        .filter((entry) => !seen.has(entry.id))
        .forEach((entry) => {
          seen.add(entry.id)
          emit(describe(entry.event))
        })
    }
    // Back off while GitHub is unreachable, but never past the deadline.
    await sleep(Math.min(interval * Math.min(2 ** state.failures, 8), Math.max(0, deadline - now())))
  }
  emit("github watch ended; start a new watcher before the next round")
  return { seen: seen.size }
}

async function poll(run: IntakeRunner, endpoint: string) {
  const result = await run(["gh", "api", "--method", "GET", `${endpoint}&per_page=100`])
  if (result.exitCode !== 0 || result.timedOut) throw new Error(`gh api failed (exit ${result.exitCode})`)
  const rows = JSON.parse(result.stdout)
  if (!Array.isArray(rows)) throw new Error("GitHub returned a non-list page")
  return rows as Record<string, unknown>[]
}

function describe(event: Record<string, unknown>) {
  const url = String(event.html_url ?? "")
  const number = url.match(/\/(?:issues|pull)\/(\d+)/)?.[1] ?? String(event.number ?? "?")
  const login = typeof event.user === "object" && event.user ? String((event.user as { login?: unknown }).login) : "?"
  const kind = event.pull_request_review_id
    ? "review-comment"
    : event.issue_url
      ? "comment"
      : event.pull_request
        ? "pull-request"
        : "issue"
  return `github ${kind} #${number} by ${login}: ${url}`
}
