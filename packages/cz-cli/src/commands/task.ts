import type { Argv } from "yargs"
import { readFileSync } from "node:fs"
import {
  listTasks, createTask, getTaskDetail, getTaskConfigDetail,
  saveTaskContent, saveTaskConfig, submitTask, onlineTask, offlineTask,
  getTaskDependencies, listFolders, createFolder,
  getFlowDag, createFlowNode, bindFlowNode, unbindFlowNode,
  removeFlowNode, submitFlow, listFlowInstances,
  saveFlowNodeContent, getFlowNodeDetail, saveFlowNodeConfig,
  type StudioConfig,
} from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, error } from "../output/index.js"
import { logOperation } from "../logger.js"
import { getStudioContext } from "./studio-context.js"

const TASK_TYPE_MAP: Record<string, number> = {
  SQL: 23, PYTHON: 26, SHELL: 24, SPARK: 400, FLOW: 500,
}

function parseTaskType(value: string): number {
  const upper = value.toUpperCase()
  if (upper in TASK_TYPE_MAP) return TASK_TYPE_MAP[upper]
  const n = parseInt(value, 10)
  if (!isNaN(n)) return n
  throw new Error(`Unsupported task type: ${value}. Use SQL/PYTHON/SHELL/SPARK/FLOW or integer code.`)
}

function normalizeCron(value: string): string {
  const parts = value.split(/\s+/)
  if (parts.length === 5) {
    const [min, hr, day, month, week] = parts
    return `0 ${min} ${hr} ${day} ${month} ${week === "*" ? "?" : week} *`
  }
  if (parts.length === 6) return parts.join(" ") + " *"
  if (parts.length === 7) return parts.join(" ")
  throw new Error("Cron expression must have 5, 6, or 7 fields.")
}

async function ctx(argv: Record<string, unknown>): Promise<StudioConfig> {
  return getStudioContext(argv)
}

export function registerTaskCommand(cli: Argv<GlobalArgs>): void {
  cli.command("task", "Manage Studio tasks", (yargs) =>
    yargs
      .command(
        "list",
        "List tasks",
        (y) =>
          y
            .option("page", { type: "number", default: 1 })
            .option("page-size", { type: "number", default: 10 })
            .option("parent", { type: "number", describe: "Folder ID filter" })
            .option("like", { type: "string", describe: "Task name filter" })
            .option("type", { type: "string", describe: "Task type (SQL/PYTHON/SHELL/SPARK/FLOW)" }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const fileType = argv.type ? String(parseTaskType(argv.type)) : undefined
            const resp = await listTasks(sc, {
              projectId: sc.projectId,
              page: argv.page,
              pageSize: argv["page-size"],
              folderId: argv.parent,
              fileName: argv.like,
              fileType,
            })
            logOperation("task list", { ok: true })
            success(resp.data, { format })
          } catch (err) {
            error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "list-folders",
        "List task folders",
        (y) =>
          y
            .option("page", { type: "number", default: 1 })
            .option("page-size", { type: "number", default: 10 })
            .option("parent", { type: "number", default: 0, describe: "Parent folder ID" }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const resp = await listFolders(sc, {
              projectId: sc.projectId,
              page: argv.page,
              pageSize: argv["page-size"],
              parentFolderId: argv.parent,
            })
            logOperation("task list-folders", { ok: true })
            success(resp.data, { format })
          } catch (err) {
            error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "create <name>",
        "Create a new task",
        (y) =>
          y
            .positional("name", { type: "string", demandOption: true })
            .option("type", { type: "string", demandOption: true, describe: "SQL/PYTHON/SHELL/SPARK/FLOW" })
            .option("folder", { type: "number", default: 0, describe: "Folder ID" })
            .option("description", { type: "string", describe: "Task description" }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const resp = await createTask(sc, {
              fileType: String(parseTaskType(argv.type as string)),
              createdBy: String(sc.userId),
              projectId: sc.projectId,
              dataFileName: argv.name as string,
              fileDescription: argv.description,
              dataFolderId: argv.folder,
              workspaceName: sc.workspaceName,
            })
            logOperation("task create", { ok: true })
            success(resp.data, { format })
          } catch (err) {
            error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "create-folder <name>",
        "Create a task folder",
        (y) =>
          y
            .positional("name", { type: "string", demandOption: true })
            .option("parent", { type: "number", default: 0, describe: "Parent folder ID" }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const resp = await createFolder(sc, {
              createdBy: String(sc.userId),
              projectId: sc.projectId,
              dataFolderName: argv.name as string,
              parentFolderId: argv.parent,
            })
            logOperation("task create-folder", { ok: true })
            success(resp.data, { format })
          } catch (err) {
            error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "content <id>",
        "Get task content and config",
        (y) => y.positional("id", { type: "number", demandOption: true }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const fileId = argv.id as number
            const [detail, config] = await Promise.all([
              getTaskDetail(sc, fileId),
              getTaskConfigDetail(sc, { projectId: sc.projectId, workspaceId: sc.workspaceId, dataFileId: fileId }),
            ])
            logOperation("task content", { ok: true })
            success({ detail: detail.data, config: config.data }, { format })
          } catch (err) {
            error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "save-content <id>",
        "Save task script content",
        (y) =>
          y
            .positional("id", { type: "number", demandOption: true })
            .option("content", { type: "string", describe: "Script content" })
            .option("file", { alias: "f", type: "string", describe: "Read content from file" }),
        async (argv) => {
          const format = argv.output
          try {
            if (!argv.content && !argv.file) {
              error("INVALID_ARGUMENTS", "Provide --content or --file.", { format, exitCode: 2 })
            }
            const text = argv.content ?? readFileSync(argv.file as string, "utf-8")
            const sc = await ctx(argv)
            const resp = await saveTaskContent(sc, {
              dataFileId: argv.id as number,
              dataFileContent: text,
              projectId: sc.projectId,
              updateBy: String(sc.userId),
              instanceName: sc.instanceName,
            })
            logOperation("task save-content", { ok: true })
            success(resp.data, { format })
          } catch (err) {
            error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "save-config <id>",
        "Save task schedule config",
        (y) =>
          y
            .positional("id", { type: "number", demandOption: true })
            .option("cron", { type: "string", describe: "Cron expression (5/6/7 fields)" })
            .option("vc", { type: "string", describe: "Virtual cluster code" })
            .option("schema", { type: "string", describe: "Schema name" })
            .option("retry-count", { type: "number", describe: "Retry count" })
            .option("timeout", { type: "number", describe: "Execute timeout" })
            .option("timeout-unit", { type: "string", default: "MINUTES", describe: "Timeout unit" }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const cronExpress = argv.cron ? normalizeCron(argv.cron) : undefined
            const resp = await saveTaskConfig(sc, {
              dataFileId: argv.id as number,
              projectId: sc.projectId,
              updateBy: String(sc.userId),
              instanceName: sc.instanceName,
              cronExpress,
              etlVcCode: argv.vc,
              schemaName: argv.schema,
              retryCount: argv["retry-count"],
              executeTimeout: argv.timeout,
              executeTimeoutUnit: argv["timeout-unit"],
            })
            logOperation("task save-config", { ok: true })
            success(resp.data, { format })
          } catch (err) {
            error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "deps <id>",
        "Show task dependencies",
        (y) => y.positional("id", { type: "number", demandOption: true }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const resp = await getTaskDependencies(sc, {
              currentId: argv.id as number,
              fileIds: [argv.id as number],
            })
            logOperation("task deps", { ok: true })
            success(resp.data, { format })
          } catch (err) {
            error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "online <id>",
        "Publish/online a task",
        (y) => y.positional("id", { type: "number", demandOption: true }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const resp = await submitTask(sc, {
              commitMsg: "Published via cz-tool",
              dataFileId: argv.id as number,
              projectId: sc.projectId,
              updatedBy: String(sc.userId),
            })
            await onlineTask(sc, argv.id as number, sc.projectId)
            logOperation("task online", { ok: true })
            success({ data: resp.data, status: "online" }, { format })
          } catch (err) {
            error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "offline <id>",
        "Take a task offline",
        (y) => y.positional("id", { type: "number", demandOption: true }),
        async (argv) => {
          const format = argv.output
          try {
            const sc = await ctx(argv)
            const resp = await offlineTask(sc, argv.id as number, sc.projectId)
            logOperation("task offline", { ok: true })
            success({ data: resp.data, status: "offline" }, { format })
          } catch (err) {
            error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command("flow", "Flow task operations", (flowYargs) =>
        flowYargs
          .command(
            "dag <id>",
            "Get flow DAG",
            (y) => y.positional("id", { type: "number", demandOption: true }),
            async (argv) => {
              const format = argv.output
              try {
                const sc = await ctx(argv)
                const resp = await getFlowDag(sc, argv.id as number)
                logOperation("task flow dag", { ok: true })
                success(resp.data, { format })
              } catch (err) {
                error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
              }
            },
          )
          .command(
            "create-node",
            "Add node to flow",
            (y) =>
              y
                .option("flow-id", { type: "number", demandOption: true })
                .option("name", { type: "string", demandOption: true })
                .option("type", { type: "string", demandOption: true, describe: "SQL/PYTHON/SHELL/SPARK" })
                .option("description", { type: "string" }),
            async (argv) => {
              const format = argv.output
              try {
                const sc = await ctx(argv)
                const resp = await createFlowNode(sc, {
                  dataFileId: argv["flow-id"] as number,
                  projectId: sc.projectId,
                  nodeName: argv.name as string,
                  fileType: String(parseTaskType(argv.type as string)),
                  env: sc.env,
                  nodeDescription: argv.description,
                })
                logOperation("task flow create-node", { ok: true })
                success(resp.data, { format })
              } catch (err) {
                error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
              }
            },
          )
          .command(
            "remove-node",
            "Remove node from flow",
            (y) =>
              y
                .option("flow-id", { type: "number", demandOption: true })
                .option("node-id", { type: "number", demandOption: true }),
            async (argv) => {
              const format = argv.output
              try {
                const sc = await ctx(argv)
                const resp = await removeFlowNode(sc, {
                  fileId: argv["flow-id"] as number,
                  nodeId: argv["node-id"] as number,
                })
                logOperation("task flow remove-node", { ok: true })
                success(resp.data, { format })
              } catch (err) {
                error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
              }
            },
          )
          .command(
            "bind",
            "Create dependency between flow nodes",
            (y) =>
              y
                .option("flow-id", { type: "number", demandOption: true })
                .option("node-id", { type: "number", demandOption: true })
                .option("dep-flow-id", { type: "number", demandOption: true })
                .option("dep-node-id", { type: "number", demandOption: true }),
            async (argv) => {
              const format = argv.output
              try {
                const sc = await ctx(argv)
                const resp = await bindFlowNode(sc, {
                  currentFileId: argv["flow-id"] as number,
                  currentNodeId: argv["node-id"] as number,
                  currentProjectId: sc.projectId,
                  dependencyFileId: argv["dep-flow-id"] as number,
                  dependencyNodeId: argv["dep-node-id"] as number,
                  dependencyProjectId: sc.projectId,
                })
                logOperation("task flow bind", { ok: true })
                success(resp.data, { format })
              } catch (err) {
                error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
              }
            },
          )
          .command(
            "unbind",
            "Remove dependency between flow nodes",
            (y) =>
              y
                .option("dep-id", { type: "number", demandOption: true })
                .option("flow-id", { type: "number", demandOption: true }),
            async (argv) => {
              const format = argv.output
              try {
                const sc = await ctx(argv)
                const resp = await unbindFlowNode(sc, {
                  depId: argv["dep-id"] as number,
                  fileId: argv["flow-id"] as number,
                })
                logOperation("task flow unbind", { ok: true })
                success(resp.data, { format })
              } catch (err) {
                error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
              }
            },
          )
          .command(
            "node-detail",
            "Get flow node detail",
            (y) =>
              y
                .option("flow-id", { type: "number", demandOption: true })
                .option("node-id", { type: "number", demandOption: true }),
            async (argv) => {
              const format = argv.output
              try {
                const sc = await ctx(argv)
                const resp = await getFlowNodeDetail(sc, argv["flow-id"] as number, argv["node-id"] as number)
                logOperation("task flow node-detail", { ok: true })
                success(resp.data, { format })
              } catch (err) {
                error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
              }
            },
          )
          .command(
            "node-save",
            "Save flow node script content",
            (y) =>
              y
                .option("flow-id", { type: "number", demandOption: true })
                .option("node-id", { type: "number", demandOption: true })
                .option("content", { type: "string" })
                .option("file", { alias: "f", type: "string" }),
            async (argv) => {
              const format = argv.output
              try {
                if (!argv.content && !argv.file) {
                  error("INVALID_ARGUMENTS", "Provide --content or --file.", { format, exitCode: 2 })
                }
                const text = argv.content ?? readFileSync(argv.file as string, "utf-8")
                const sc = await ctx(argv)
                const resp = await saveFlowNodeContent(sc, {
                  dataFileId: argv["flow-id"] as number,
                  nodeId: argv["node-id"] as number,
                  dataFileContent: text,
                  projectId: sc.projectId,
                  updateBy: String(sc.userId),
                  instanceName: sc.instanceName,
                })
                logOperation("task flow node-save", { ok: true })
                success(resp.data, { format })
              } catch (err) {
                error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
              }
            },
          )
          .command(
            "node-save-config",
            "Save flow node schedule config",
            (y) =>
              y
                .option("flow-id", { type: "number", demandOption: true })
                .option("node-id", { type: "number", demandOption: true })
                .option("cron", { type: "string" })
                .option("vc", { type: "string" })
                .option("schema", { type: "string" }),
            async (argv) => {
              const format = argv.output
              try {
                const sc = await ctx(argv)
                const resp = await saveFlowNodeConfig(sc, {
                  dataFileId: argv["flow-id"] as number,
                  nodeId: argv["node-id"] as number,
                  projectId: sc.projectId,
                  updateBy: String(sc.userId),
                  instanceName: sc.instanceName,
                  cronExpress: argv.cron ? normalizeCron(argv.cron) : undefined,
                  etlVcCode: argv.vc,
                  schemaName: argv.schema,
                })
                logOperation("task flow node-save-config", { ok: true })
                success(resp.data, { format })
              } catch (err) {
                error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
              }
            },
          )
          .command(
            "submit",
            "Publish flow",
            (y) => y.option("flow-id", { type: "number", demandOption: true }),
            async (argv) => {
              const format = argv.output
              try {
                const sc = await ctx(argv)
                const resp = await submitFlow(sc, {
                  fileId: argv["flow-id"] as number,
                  projectId: sc.projectId,
                  env: sc.env,
                })
                logOperation("task flow submit", { ok: true })
                success(resp.data, { format })
              } catch (err) {
                error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
              }
            },
          )
          .command(
            "instances",
            "List flow node instances",
            (y) => y.option("flow-id", { type: "number", demandOption: true }),
            async (argv) => {
              const format = argv.output
              try {
                const sc = await ctx(argv)
                const resp = await listFlowInstances(sc, {
                  flowId: argv["flow-id"] as number,
                })
                logOperation("task flow instances", { ok: true })
                success(resp.data, { format })
              } catch (err) {
                error("TASK_ERROR", err instanceof Error ? err.message : String(err), { format })
              }
            },
          )
          .demandCommand(1, ""),
      )
      .demandCommand(1, ""),
  )
}
