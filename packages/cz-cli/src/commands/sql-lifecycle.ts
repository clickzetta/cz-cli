import { abortAfter, cancelJobAndWait, type ClientOptions, type JobID } from "@clickzetta/sdk"
import { registerSqlCleanup } from "../sql/cleanup-scope.js"
import { parseOutputArgs, renderErrorOutput } from "../output/index.js"

const active = new Map<string, { abort(): void; finish(state: "terminal" | "detached" | "cancel"): Promise<void> }>()
let shutdown: Promise<void> | undefined

export function hasActiveSqlJobs() {
  return active.size > 0 || shutdown !== undefined
}

/** Own the remote job from before registration/submission until terminal or handoff. */
export async function trackSqlJob(opts: ClientOptions, job: JobID, timeoutMs?: number) {
  if (shutdown) throw new Error("SQL execution is stopping")
  const controller = new AbortController()
  const deadline = timeoutMs === undefined ? undefined : abortAfter(timeoutMs, controller.signal)
  const signal = deadline?.signal ?? controller.signal
  let supervisor: Awaited<ReturnType<typeof registerSqlCleanup>>
  let completion: Promise<void> | undefined
  const lease = {
    abort: () => controller.abort(new Error("SQL execution interrupted")),
    finish(state: "terminal" | "detached" | "cancel") {
      if (completion) return completion
      completion = (async () => {
        try {
          if (state === "cancel") {
            const result = await cancelJobAndWait(opts, job, 1500)
            if (!result.confirmed) {
              process.stderr.write(
                `SQL job ${job.id}: cancellation unconfirmed; parent cleanup or server timeout must recover it.\n`,
              )
              return
            }
          }
          // A detached job is delivered only after its supervisor acknowledges handoff.
          await supervisor?.release().catch(async () => {
            if (state === "detached") {
              const result = await cancelJobAndWait(opts, job, 1500)
              if (!result.confirmed) {
                process.stderr.write(`SQL job ${job.id}: cancellation after failed async handoff is unconfirmed.\n`)
              }
              throw Object.assign(new Error(`SQL job ${job.id}: async handoff acknowledgement failed`), {
                jobId: job.id,
              })
            }
            // The parent can re-confirm a terminal job if its acknowledgement was lost.
            process.stderr.write(`SQL job ${job.id}: cleanup acknowledgement failed.\n`)
          })
        } finally {
          deadline?.dispose()
          supervisor?.abandon()
          active.delete(job.id)
          if (active.size === 0 && !shutdown) {
            process.removeListener("SIGINT", interrupt)
            process.removeListener("SIGTERM", terminate)
          }
        }
      })()
      return completion
    },
  }
  if (active.size === 0) {
    process.on("SIGINT", interrupt)
    process.on("SIGTERM", terminate)
  }
  active.set(job.id, lease)
  try {
    supervisor = await registerSqlCleanup(opts, job, signal, timeoutMs ?? 300_000, lease.abort)
    signal.throwIfAborted()
    return {
      signal,
      timeoutMs,
      async finish(state: "terminal" | "detached" | "cancel") {
        await lease.finish(state)
        // Let the signal owner emit the interruption and choose the exit code.
        if (shutdown) await shutdown
      },
    }
  } catch (error) {
    await lease.finish("terminal").catch(() => {})
    throw error
  }
}

function interrupt() {
  stop("SIGINT", 130)
}
function terminate() {
  stop("SIGTERM", 143)
}

function stop(signal: string, exitCode: number) {
  if (shutdown) return
  // Install shutdown before aborting: callbacks cannot admit another SQL job.
  shutdown = Promise.resolve().then(async () => {
    const jobs = [...active.entries()]
    jobs.forEach(([, lease]) => lease.abort())
    const deadline = setTimeout(() => process.exit(exitCode), 2000)
    await Promise.allSettled(jobs.map(([, lease]) => lease.finish("cancel")))
    const output = parseOutputArgs(process.argv.slice(2))
    process.stdout.write(
      renderErrorOutput(
        {
          error: { code: "ABORTED", message: `Execution interrupted by ${signal}.` },
          job_ids: jobs.map(([id]) => id),
        },
        output.format,
        output.field,
      ) + "\n",
    )
    clearTimeout(deadline)
    process.exit(exitCode)
  })
}
