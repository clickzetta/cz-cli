import type { Argv } from "yargs"
import {
  addWorkspaceParam,
  deleteWorkspaceParam,
  disableWorkspaceParam,
  enableWorkspaceParam,
  listWorkspaceParams,
  updateWorkspaceParam,
} from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { commandGroup } from "../command-group.js"
import { logOperation } from "../logger.js"
import { error, success } from "../output/index.js"
import { getStudioContext } from "./studio-context.js"

function projectIdFromArg(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("--project-id must be a positive number.")
  }
  return parsed
}

function idFromArg(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("--id must be a positive number.")
  }
  return parsed
}

export function registerWorkspaceParamCommand(cli: Argv<GlobalArgs>): void {
  cli.command("workspace-param", "Manage Studio workspace parameters", (yargs) => {
    yargs
      .command(
        "list",
        "List Studio workspace parameters",
        (y) => y
          .option("project-id", { type: "number", describe: "Studio project ID. Defaults to the current workspace project." })
          .option("page-index", { type: "number", default: 1, describe: "Page index." })
          .option("page-size", { type: "number", default: 10, describe: "Page size." }),
        async (argv) => {
          const format = argv.format
          const t0 = Date.now()
          try {
            const sc = await getStudioContext(argv)
            const projectId = projectIdFromArg(argv["project-id"], sc.projectId)
            const resp = await listWorkspaceParams(sc, {
              projectId,
              pageIndex: Number(argv["page-index"] ?? 1),
              pageSize: Number(argv["page-size"] ?? 10),
            })
            logOperation("workspace-param list", { ok: true, timeMs: Date.now() - t0 })
            success(resp.data, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            logOperation("workspace-param list", { ok: false, timeMs: Date.now() - t0 })
            error("WORKSPACE_PARAM_LIST_FAILED", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "add",
        "Add or update a Studio workspace parameter",
        (y) => y
          .option("project-id", { type: "number", describe: "Studio project ID. Defaults to the current workspace project." })
          .option("key", { type: "string", demandOption: true, describe: "Workspace parameter key." })
          .option("value", { type: "string", default: "", describe: "Workspace parameter value." })
          .option("source-type", { type: "number", default: 0, describe: "Studio sourceType value." })
          .option("encrypt", { type: "number", default: 0, describe: "Studio encrypt value." }),
        async (argv) => {
          const format = argv.format
          const t0 = Date.now()
          try {
            const sc = await getStudioContext(argv)
            const projectId = projectIdFromArg(argv["project-id"], sc.projectId)
            const resp = await addWorkspaceParam(sc, {
              projectId,
              paramKey: String(argv.key),
              paramValue: String(argv.value ?? ""),
              sourceType: Number(argv["source-type"] ?? 0),
              encrypt: Number(argv.encrypt ?? 0),
            })
            logOperation("workspace-param add", { ok: true, timeMs: Date.now() - t0 })
            success(resp.data, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            logOperation("workspace-param add", { ok: false, timeMs: Date.now() - t0 })
            error("WORKSPACE_PARAM_ADD_FAILED", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "update",
        "Update a Studio workspace parameter",
        (y) => y
          .option("project-id", { type: "number", describe: "Studio project ID. Defaults to the current workspace project." })
          .option("id", { type: "number", demandOption: true, describe: "Workspace parameter ID." })
          .option("key", { type: "string", demandOption: true, describe: "Workspace parameter key." })
          .option("value", { type: "string", default: "", describe: "Workspace parameter value." })
          .option("source-type", { type: "number", default: 0, describe: "Studio sourceType value." })
          .option("encrypt", { type: "number", default: 0, describe: "Studio encrypt value." }),
        async (argv) => {
          const format = argv.format
          const t0 = Date.now()
          try {
            const sc = await getStudioContext(argv)
            const projectId = projectIdFromArg(argv["project-id"], sc.projectId)
            const resp = await updateWorkspaceParam(sc, {
              projectId,
              id: idFromArg(argv.id),
              paramKey: String(argv.key),
              paramValue: String(argv.value ?? ""),
              sourceType: Number(argv["source-type"] ?? 0),
              encrypt: Number(argv.encrypt ?? 0),
            })
            logOperation("workspace-param update", { ok: true, timeMs: Date.now() - t0 })
            success(resp.data, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            logOperation("workspace-param update", { ok: false, timeMs: Date.now() - t0 })
            error("WORKSPACE_PARAM_UPDATE_FAILED", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "enable",
        "Enable a Studio workspace parameter",
        (y) => y
          .option("project-id", { type: "number", describe: "Studio project ID. Defaults to the current workspace project." })
          .option("id", { type: "number", demandOption: true, describe: "Workspace parameter ID." }),
        async (argv) => {
          const format = argv.format
          const t0 = Date.now()
          try {
            const sc = await getStudioContext(argv)
            const projectId = projectIdFromArg(argv["project-id"], sc.projectId)
            const resp = await enableWorkspaceParam(sc, { projectId, id: idFromArg(argv.id) })
            logOperation("workspace-param enable", { ok: true, timeMs: Date.now() - t0 })
            success(resp.data, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            logOperation("workspace-param enable", { ok: false, timeMs: Date.now() - t0 })
            error("WORKSPACE_PARAM_ENABLE_FAILED", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "disable",
        "Disable a Studio workspace parameter",
        (y) => y
          .option("project-id", { type: "number", describe: "Studio project ID. Defaults to the current workspace project." })
          .option("id", { type: "number", demandOption: true, describe: "Workspace parameter ID." }),
        async (argv) => {
          const format = argv.format
          const t0 = Date.now()
          try {
            const sc = await getStudioContext(argv)
            const projectId = projectIdFromArg(argv["project-id"], sc.projectId)
            const resp = await disableWorkspaceParam(sc, { projectId, id: idFromArg(argv.id) })
            logOperation("workspace-param disable", { ok: true, timeMs: Date.now() - t0 })
            success(resp.data, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            logOperation("workspace-param disable", { ok: false, timeMs: Date.now() - t0 })
            error("WORKSPACE_PARAM_DISABLE_FAILED", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
      .command(
        "delete",
        "Delete a Studio workspace parameter",
        (y) => y
          .option("project-id", { type: "number", describe: "Studio project ID. Defaults to the current workspace project." })
          .option("id", { type: "number", demandOption: true, describe: "Workspace parameter ID." }),
        async (argv) => {
          const format = argv.format
          const t0 = Date.now()
          try {
            const sc = await getStudioContext(argv)
            const projectId = projectIdFromArg(argv["project-id"], sc.projectId)
            const resp = await deleteWorkspaceParam(sc, { projectId, id: idFromArg(argv.id) })
            logOperation("workspace-param delete", { ok: true, timeMs: Date.now() - t0 })
            success(resp.data, { format, timeMs: Date.now() - t0 })
          } catch (err) {
            logOperation("workspace-param delete", { ok: false, timeMs: Date.now() - t0 })
            error("WORKSPACE_PARAM_DELETE_FAILED", err instanceof Error ? err.message : String(err), { format })
          }
        },
      )
    return commandGroup(yargs, "workspace-param")
  })
}
