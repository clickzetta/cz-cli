import { findTask, initializeRuntime, loadRuntime, registerTask, saveTask } from "./maintenance/state"
import { readReceipts, reply } from "./maintenance/reply"
import { mergePullRequest, readMergeReceipts } from "./maintenance/merge"
import { readNightlyReceipts, reconcileNightlyRelease, releaseNightly } from "./maintenance/release"
import { acknowledgeIntake, pendingIntake, scanIntake, showIntake } from "./maintenance/intake"
import type { IntakeSource } from "./maintenance/intake"
import { pendingMemory, recordMemory, resolveMemory } from "./maintenance/memory"
import { acknowledgeRules, syncControl } from "./maintenance/sync"

export async function main(args = Bun.argv.slice(2)) {
  if (args[0] === "sync" && args.length <= 2) return syncControl(process.cwd(), args[1])
  if (args[0] === "rules-read" && args.length === 3) return acknowledgeRules(process.cwd(), args[1], args[2])
  const runtime = await loadRuntime()
  const action = args[0] ?? "status"
  if (action === "memory") {
    if (args[1] === "pending" && args.length === 2) return pendingMemory(runtime.directory)
    if (args[1] === "record" && args.length === 3)
      return recordMemory(runtime.directory, await Bun.file(args[2]).json())
    if (args[1] === "resolve" && args.length === 4)
      return resolveMemory(runtime.directory, args[2], await Bun.file(args[3]).json())
    throw new Error("Use: memory record FILE | memory pending | memory resolve ID FILE")
  }
  if (action === "intake") {
    const operation = ["ack", "show", "pending"].includes(args[1]) ? args[1] : "scan"
    const source = operation === "scan" ? args[1] : args[2]
    if (source !== "feishu" && source !== "github") throw new Error("Intake source must be feishu or github")
    if (operation === "scan" && args.length === 2) return scanIntake(runtime, source)
    if (operation === "pending" && args.length === 3) return pendingIntake(runtime.directory, source)
    if (operation === "show" && args.length === 4) return showIntake(runtime.directory, source, args[3])
    if (operation === "ack") {
      const options = args.slice(4)
      const parsed = new Map<string, string>()
      for (let index = 0; index < options.length; index++) {
        const option = options[index]
        if (!["--task", "--note"].includes(option) || parsed.has(option))
          throw new Error("Unknown or repeated intake ack option")
        const value = options[++index]
        if (!value || value.startsWith("--")) throw new Error(`Missing value for ${option}`)
        parsed.set(option, value)
      }
      return acknowledgeIntake(runtime, source as IntakeSource, args[3] ?? "", {
        taskId: parsed.get("--task"),
        note: parsed.get("--note"),
      })
    }
    throw new Error(
      "Use: intake SOURCE | intake pending SOURCE | intake show SOURCE KEY | intake ack SOURCE KEY [--task ID] [--note TEXT]",
    )
  }
  if (action === "init" && args.length === 1) {
    const initialized = await initializeRuntime(runtime.directory)
    return {
      directory: runtime.directory,
      tasks: initialized.tasks.length,
      permissions: initialized.config.permissions,
    }
  }
  if (action === "status" && args.length <= 1) {
    return {
      directory: runtime.directory,
      repository: runtime.config.repository,
      baseRef: runtime.config.baseRef,
      permissions: runtime.config.permissions,
      counts: Object.fromEntries(
        ["pending", "running", "review", "completed", "ignored", "needs_attention"].map((status) => [
          status,
          runtime.tasks.filter((task) => task.status === status).length,
        ]),
      ),
      tasks: runtime.tasks.map((task) => ({
        id: task.id,
        source: task.item.source,
        sourceId: task.item.id,
        status: task.status,
        worktree: task.worktree,
        baseSha: task.baseSha,
        headSha: task.headSha,
        reviewedSha: task.reviewedSha,
      })),
      receipts: (await readReceipts(runtime.directory)).map((receipt) => ({
        key: receipt.key,
        taskId: receipt.taskId,
        phase: receipt.phase,
        event: receipt.event,
        status: receipt.status,
        messageId: receipt.messageId,
        file: receipt.file,
      })),
      merges: await readMergeReceipts(runtime.directory),
      nightly: await readNightlyReceipts(runtime.directory),
    }
  }
  if ((action === "register" || action === "save") && args.length === 2) {
    const input: unknown = await Bun.file(args[1]).json()
    if (action === "register") return registerTask(runtime.directory, input)
    return saveTask(runtime.directory, input)
  }
  if (action === "task" && args.length === 2) {
    const task = findTask(runtime.tasks, args[1], runtime.config.repository)
    if (!task) throw new Error(`Unknown task or source: ${args[1]}`)
    return task
  }
  if (action === "merge" && (args.length === 3 || (args.length === 4 && args[3] === "--merge"))) {
    const task = findTask(runtime.tasks, args[1], runtime.config.repository)
    if (!task) throw new Error(`Unknown task or source: ${args[1]}`)
    return mergePullRequest({
      directory: runtime.directory,
      config: runtime.config,
      task,
      pullRequestNumber: Number(args[2]),
      merge: args[3] === "--merge",
    })
  }
  if (action === "nightly" && (args.length === 3 || (args.length === 4 && args[3] === "--publish"))) {
    return releaseNightly({
      directory: runtime.directory,
      config: runtime.config,
      version: args[1],
      sha: args[2],
      execute: args[3] === "--publish",
    })
  }
  if (action === "nightly-status" && args.length === 2) return reconcileNightlyRelease(runtime.directory, args[1])
  if (action === "reply") {
    const phase = args[2]
    if (phase !== "接单" && phase !== "阻碍" && phase !== "审查完成" && phase !== "发布完成")
      throw new Error("Reply phase must be 接单, 阻碍, 审查完成 or 发布完成")
    const options = args.slice(3)
    const parsed = new Map<string, string | boolean>()
    for (let index = 0; index < options.length; index++) {
      const option = options[index]
      if (!["--event", "--text-file", "--send"].includes(option) || parsed.has(option))
        throw new Error(`Unknown or repeated reply option: ${option}`)
      if (option === "--send") {
        parsed.set(option, true)
        continue
      }
      const value = options[++index]
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${option}`)
      parsed.set(option, value)
    }
    const event = parsed.get("--event")
    const file = parsed.get("--text-file")
    if (typeof event !== "string" || typeof file !== "string")
      throw new Error("Reply requires --event EVENT --text-file FILE; --send explicitly enables delivery")
    const task = findTask(runtime.tasks, args[1], runtime.config.repository)
    if (!task) throw new Error(`Unknown task or source: ${args[1]}`)
    return reply({
      directory: runtime.directory,
      config: runtime.config,
      task,
      phase,
      event,
      text: await Bun.file(file).text(),
      send: parsed.get("--send") === true,
    })
  }
  throw new Error(
    "Use: sync [worker|curator] | rules-read ROLE SHA | init | status | memory record FILE | memory pending | memory resolve ID FILE | intake SOURCE | intake pending SOURCE | intake show SOURCE KEY | intake ack SOURCE KEY [--task ID] [--note TEXT] | task ID_OR_SOURCE | register ITEM.json | save TASK.json | reply TASK PHASE --event EVENT --text-file FILE [--send] | merge TASK PR [--merge] | nightly VERSION SHA [--publish] | nightly-status SHA",
  )
}

if (import.meta.main) {
  main().then(
    (result) => console.log(JSON.stringify(result, null, 2)),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    },
  )
}
