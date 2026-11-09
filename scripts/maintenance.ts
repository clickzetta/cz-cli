import { findTask, initializeRuntime, loadRuntime, registerTask, saveTask } from "./maintenance/state"
import { readReceipts, reply } from "./maintenance/reply"

export async function main(args = Bun.argv.slice(2)) {
  const runtime = await loadRuntime()
  const action = args[0] ?? "status"
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
    "Use: init | status | task ID_OR_SOURCE | register ITEM.json | save TASK.json | reply TASK PHASE --event EVENT --text-file FILE [--send]",
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
