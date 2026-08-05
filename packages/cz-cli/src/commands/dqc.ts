import type { Argv } from "yargs"
import { commandGroup } from "../command-group.js"
import {
  listDqcRules,
  createDqcSqlRule,
  getDqcRule,
  updateDqcRuleFull,
  runDqcRule,
  deleteDqcRule,
  getDqcStatistics,
  listVclusters,
  studioRequest,
  type StudioConfig,
  type DqcOperator,
  type DqcTriggerType,
  type DqcTrigger,
} from "@clickzetta/sdk"
import type { GlobalArgs } from "../cli.js"
import { success, error, handledError, isHandledCliError } from "../output/index.js"
import { logOperation } from "../logger.js"
import { getStudioContext } from "./studio-context.js"
import { confirm } from "../confirm.js"

const DQC_OPERATORS: DqcOperator[] = ["EQUAL", "NOT_EQUAL", "LESS_THAN", "LESS_EQUAL", "GREATER_THAN", "GREATER_EQUAL"]
const DQC_TRIGGER_TYPES: DqcTriggerType[] = ["REST", "PLAN", "SCHEDULE_TASK"]
// DQC rules run SQL, so they need a compute VC (GENERAL/ANALYTICS); sync-only
// INTEGRATION VClusters cannot run queries.
const DQC_COMPUTE_VC_TYPES = new Set(["GENERAL", "ANALYTICS"])

async function ctx(argv: Record<string, unknown>): Promise<StudioConfig> {
  return getStudioContext(argv)
}

function reportError(err: unknown, format: string | undefined): void {
  if (isHandledCliError(err)) return
  error("DQC_ERROR", err instanceof Error ? err.message : String(err), { format })
}

// checkerInfo JSON: fixed threshold (FIXED) + comparison operator + value.
function buildCheckerInfo(operator: DqcOperator, value: number): string {
  return JSON.stringify({ checker: "FIXED", operator, value })
}

function isDqcOperator(value: unknown): value is DqcOperator {
  return typeof value === "string" && (DQC_OPERATORS as string[]).includes(value)
}

// List compute VClusters (GENERAL/ANALYTICS) usable for running DQC rules.
async function listComputeVclusters(sc: StudioConfig): Promise<string[]> {
  const list = await listVclusters(sc).catch(() => [])
  return list
    .filter((vc) => DQC_COMPUTE_VC_TYPES.has(String(vc.type ?? "").toUpperCase()))
    .map((vc) => vc.name)
    .filter(Boolean)
}

// Existence check for a scheduler task id. Only guards against passing a draft
// dataFileId / non-existent id as scheduleTaskId. Fails open (returns true) on
// query errors so the backend makes the final call.
async function schedulerTaskExists(sc: StudioConfig, scheduleTaskId: number): Promise<boolean> {
  try {
    const resp = await studioRequest<unknown>(sc, "/ide-admin/v1/scheduleTask/getDetail", {
      scheduleTaskId,
      projectId: sc.projectId,
    }, { env: "prod" })
    return Boolean((resp as { data?: unknown }).data)
  } catch {
    return true
  }
}

// Validate and normalize the trigger. Returns the backend trigger object or
// throws a handled usage error. Fields not part of the current trigger type
// are set to null so a full-object update clears stale residue.
async function validateTrigger(
  argv: Record<string, unknown>,
  sc: StudioConfig,
  format: string | undefined,
): Promise<DqcTrigger> {
  const triggerType = (argv["trigger-type"] as string | undefined) ?? "REST"
  if (!(DQC_TRIGGER_TYPES as string[]).includes(triggerType)) {
    handledError("INVALID_ARGUMENTS", `--trigger-type must be one of ${DQC_TRIGGER_TYPES.join("/")}.`, { format, exitCode: 2 })
  }
  const trigger: DqcTrigger = {
    triggerType: triggerType as DqcTriggerType,
    triggerCron: null,
    mainSchedulerTaskId: null,
    subSchedulerTaskId: null,
    level: null,
  }

  if (triggerType === "PLAN") {
    const cron = argv.cron as string | undefined
    if (!cron) handledError("INVALID_ARGUMENTS", "--cron is required for PLAN trigger type (e.g. '0 00 00 * * ? *').", { format, exitCode: 2 })
    trigger.triggerCron = cron!
    return trigger
  }

  if (triggerType === "SCHEDULE_TASK") {
    const mainId = argv["main-task"] as number | undefined
    const level = argv.level as number | undefined
    const subId = argv["sub-task"] as number | undefined
    if (mainId == null) handledError("INVALID_ARGUMENTS", "--main-task is required for SCHEDULE_TASK trigger type.", { format, exitCode: 2 })
    if (level == null) handledError("INVALID_ARGUMENTS", "--level is required for SCHEDULE_TASK trigger type (0=non-blocking, 1=blocking).", { format, exitCode: 2 })
    if (!(await schedulerTaskExists(sc, mainId!))) {
      handledError("INVALID_ARGUMENTS", `--main-task ${mainId} is not a valid schedule task. It must be the schedule task id of a deployed periodic task (not a draft dataFileId). List deployed tasks with 'cz-cli task list' first.`, { format, exitCode: 2 })
    }
    if (subId != null && !(await schedulerTaskExists(sc, subId))) {
      handledError("INVALID_ARGUMENTS", `--sub-task ${subId} is not a valid schedule task.`, { format, exitCode: 2 })
    }
    trigger.mainSchedulerTaskId = mainId!
    trigger.level = level!
    if (subId != null) trigger.subSchedulerTaskId = subId
    return trigger
  }

  return trigger
}

// Shared trigger options for create/update.
function triggerOptions(y: Argv<GlobalArgs>): Argv<GlobalArgs> {
  return y
    .option("trigger-type", { type: "string", choices: DQC_TRIGGER_TYPES, describe: "REST=manual (default), PLAN=scheduled (needs --cron), SCHEDULE_TASK=attach to a deployed periodic task (needs --main-task + --level)" })
    .option("cron", { type: "string", describe: "Cron expression, required for PLAN, e.g. '0 00 00 * * ? *'" })
    .option("main-task", { type: "number", describe: "Depended-on schedule task id, required for SCHEDULE_TASK" })
    .option("sub-task", { type: "number", describe: "Sub-task id, only when the depended-on task is a composite (flow) task" })
    .option("level", { type: "number", choices: [0, 1], describe: "Gate strength for SCHEDULE_TASK: 0=non-blocking, 1=blocking" })
}

function ruleListRow(r: Record<string, unknown>): Record<string, unknown> {
  return {
    rule_id: r.id,
    object_name: r.objectName,
    tag_code: r.tagCode,
    column_name: r.properties,
    trigger_type: r.triggerType,
    vcluster: r.vcluster,
    checker_info: r.checkerInfo,
    latest_status: r.latestStatus,
    latest_start_time: r.latestStartTime,
    owner_name: r.ownerName,
    create_time: r.createTime,
  }
}

export function registerDqcCommand(cli: Argv<GlobalArgs>): void {
  cli.command("dqc", "Manage data quality check (DQC) rules", (yargs) => {
    yargs
      .command(
        "list",
        "List data quality rules, optionally filtered by table name.",
        (y) =>
          y
            .option("object", { type: "string", describe: "Fuzzy search by table name (schema.table)" })
            .option("page", { type: "number", default: 1, describe: "Page number (default: 1)" })
            .option("page-size", { type: "number", default: 10, describe: "Page size (default: 10)" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const resp = await listDqcRules(sc, {
              projectId: sc.projectId,
              fuzzyObjectName: argv.object as string | undefined,
              pageNum: argv.page as number,
              pageSize: argv["page-size"] as number,
            })
            const rules = Array.isArray(resp.data) ? (resp.data as Record<string, unknown>[]) : []
            logOperation("dqc list", { ok: true })
            success(rules.map(ruleListRow), {
              format,
              extra: { pagination: { page: argv.page, page_size: argv["page-size"], total: (resp as { total?: number }).total } },
            })
          } catch (err) {
            reportError(err, format)
          }
        },
      )
      .command(
        "create",
        "Create a data quality rule (custom SQL). The SQL returns a single number (usually violation count) compared against --value with --operator.",
        (y) =>
          triggerOptions(
            y
              .option("table", { type: "string", demandOption: true, describe: "Target table the rule attaches to (schema.table)" })
              .option("sql", { type: "string", demandOption: true, describe: "SQL returning a single number, e.g. select count(*) from db.t where amount < 0" })
              .option("operator", { type: "string", demandOption: true, choices: DQC_OPERATORS, describe: "Comparison operator between the SQL result and --value" })
              .option("value", { type: "number", demandOption: true, describe: "Threshold, e.g. 0" })
              .option("vc", { type: "string", describe: "Compute VC name (GENERAL/ANALYTICS) that runs the rule. Required — omit to see available VCs." })
              .option("desc", { type: "string", describe: "Rule description" })
              .option("condition", { type: "string", describe: "Optional WHERE filter attached to the rule object" })
              .option("timeout", { type: "number", default: 10, describe: "Timeout in minutes (default: 10)" }),
          ),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const operator = argv.operator as string
            if (!isDqcOperator(operator)) {
              error("INVALID_ARGUMENTS", `--operator must be one of ${DQC_OPERATORS.join("/")}.`, { format, exitCode: 2 }); return
            }
            const vcluster = argv.vc as string | undefined
            if (!vcluster) {
              const names = await listComputeVclusters(sc)
              const hint = names.length > 0
                ? `Available compute VCs: ${names.join(", ")}`
                : "No compute VC (GENERAL/ANALYTICS) found in this workspace — create one or check permissions."
              error("VclusterRequired", `Creating a DQC rule requires a compute VC via --vc. ${hint}`, { format, exitCode: 2 }); return
            }
            const trigger = await validateTrigger(argv, sc, format)
            const resp = await createDqcSqlRule(sc, {
              projectId: sc.projectId,
              objectName: argv.table as string,
              definedSql: argv.sql as string,
              checkerInfo: buildCheckerInfo(operator, argv.value as number),
              vcluster,
              owner: String(sc.userId),
              desc: argv.desc as string | undefined,
              condition: argv.condition as string | undefined,
              timeout: argv.timeout as number,
              trigger,
            })
            logOperation("dqc create", { ok: true })
            success({
              rule_id: resp.data,
              object_name: argv.table,
              defined_sql: argv.sql,
              checker: `${operator} ${argv.value}`,
            }, { format, aiMessage: `DQC SQL rule created with id ${resp.data}. Run it now with: cz-cli dqc run ${resp.data}` })
          } catch (err) {
            reportError(err, format)
          }
        },
      )
      .command(
        "update <rule-id>",
        "Update a DQC rule (read-modify-write). Only changes explicitly given fields. --operator and --value must be given together.",
        (y) =>
          triggerOptions(
            y
              .positional("rule-id", { type: "number", demandOption: true, describe: "Rule id to update" })
              .option("sql", { type: "string", describe: "New custom SQL" })
              .option("operator", { type: "string", choices: DQC_OPERATORS, describe: "New operator (must be given with --value)" })
              .option("value", { type: "number", describe: "New threshold (must be given with --operator)" })
              .option("condition", { type: "string", describe: "New WHERE filter" })
              .option("vc", { type: "string", describe: "New compute VC name" })
              .option("desc", { type: "string", describe: "New description" }),
          ),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const ruleId = argv["rule-id"] as number

            const changes: Record<string, unknown> = {}
            if (argv.sql != null) changes.definedSql = argv.sql
            if (argv.condition != null) changes.condition = argv.condition
            if (argv.vc != null) changes.vcluster = argv.vc
            if (argv.desc != null) changes.desc = argv.desc
            if (argv["trigger-type"] != null) {
              const trigger = await validateTrigger(argv, sc, format)
              Object.assign(changes, trigger)
            }
            const operator = argv.operator as string | undefined
            const value = argv.value as number | undefined
            if (operator != null || value != null) {
              if (!isDqcOperator(operator)) {
                error("INVALID_ARGUMENTS", `--operator must be one of ${DQC_OPERATORS.join("/")}.`, { format, exitCode: 2 }); return
              }
              if (value == null) {
                error("INVALID_ARGUMENTS", "--value is required when --operator is given.", { format, exitCode: 2 }); return
              }
              changes.checkerInfo = buildCheckerInfo(operator, value)
            }
            if (Object.keys(changes).length === 0) {
              error("INVALID_ARGUMENTS", "Provide at least one field to update: --sql / --operator+--value / --condition / --vc / --desc / --trigger-type.", { format, exitCode: 2 }); return
            }

            const getResp = await getDqcRule(sc, ruleId)
            const rule = getResp.data as Record<string, unknown> | undefined
            if (!rule) {
              error("APIError", `Cannot read rule ${ruleId} detail.`, { format }); return
            }
            const payload: Record<string, unknown> = { ...rule, ...changes, id: ruleId, updater: sc.userId }
            if (!payload.owner) payload.owner = sc.userId

            await updateDqcRuleFull(sc, payload)
            logOperation("dqc update", { ok: true })
            success({ rule_id: ruleId, updated: Object.keys(changes) }, { format, aiMessage: `DQC rule ${ruleId} updated.` })
          } catch (err) {
            reportError(err, format)
          }
        },
      )
      .command(
        "stat",
        "Data quality statistics overview. rule_table=rule/table totals; rule_task=execution health with pass rate (default).",
        (y) =>
          y.option("type", { type: "string", default: "rule_task", choices: ["rule_table", "rule_task"], describe: "rule_table=rules & monitored tables; rule_task=execution health with pass rate (default)" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const statType = argv.type as "rule_table" | "rule_task"
            const resp = await getDqcStatistics(sc, statType)
            logOperation("dqc stat", { ok: true })
            success(resp.data, { format, aiMessage: `DQC statistics (${statType}).` })
          } catch (err) {
            reportError(err, format)
          }
        },
      )
      .command(
        "run <rule-id>",
        "Run a DQC rule immediately (async). Returns task_id; the check result is not returned here — query the rule task later.",
        (y) =>
          y
            .positional("rule-id", { type: "number", demandOption: true, describe: "Rule id to run" })
            .option("trigger-type", { type: "string", default: "TEST", choices: ["TEST", "REST"], describe: "Trigger type: use TEST for manual runs (default)" })
            .option("rerun", { type: "boolean", default: false, describe: "Whether to rerun (default: false)" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const ruleId = argv["rule-id"] as number
            const resp = await runDqcRule(sc, ruleId, argv["trigger-type"] as "TEST" | "REST", argv.rerun as boolean)
            logOperation("dqc run", { ok: true })
            success({ rule_id: ruleId, task_id: resp.data }, {
              format,
              aiMessage: `DQC rule ${ruleId} triggered (async), task_id=${resp.data}. The check result is fetched later by querying the rule task.`,
            })
          } catch (err) {
            reportError(err, format)
          }
        },
      )
      .command(
        "delete <rule-id>",
        "[🔴 DESTRUCTIVE] Delete a DQC rule by id. Requires confirmation.",
        (y) =>
          y
            .positional("rule-id", { type: "number", demandOption: true, describe: "Rule id to delete" })
            .option("yes", { alias: "y", type: "boolean", default: false, describe: "Skip confirmation" }),
        async (argv) => {
          const format = argv.format
          try {
            const sc = await ctx(argv)
            const ruleId = argv["rule-id"] as number
            if (!argv.yes) {
              const ok = await confirm(`Delete DQC rule ${ruleId}? This is irreversible.`)
              if (!ok) {
                success({ message: "Cancelled by user.", action: "dqc.delete", executed: false }, { format })
                return
              }
            }
            const resp = await deleteDqcRule(sc, ruleId)
            logOperation("dqc delete", { ok: true })
            success({ rule_id: ruleId, result: resp.data }, { format, aiMessage: `DQC rule ${ruleId} deleted.` })
          } catch (err) {
            reportError(err, format)
          }
        },
      )
    return commandGroup(yargs, "dqc")
  })
}

