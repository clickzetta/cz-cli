import type { StudioConfig } from "../types/index.js"
import { studioRequest } from "./client.js"

// Endpoints ported from clickzetta-studio-ai-agent
// agent/tools/infra/config/api_properties.ini (数据质量 section).
const API = {
  ADD: "/clickzetta-dqc/api/v1/rule/add",
  UPDATE: "/clickzetta-dqc/api/v1/rule/update",
  DELETE: "/clickzetta-dqc/api/v1/rule/del",
  LIST: "/clickzetta-dqc/api/v1/rule/list",
  GET: "/clickzetta-dqc/api/v1/rule/get",
  RUN: "/clickzetta-dqc/api/v1/rule/run",
  STAT_RULE_TABLE: "/clickzetta-dqc/api/v1/dqc/stat/statRuleAndTable",
  STAT_RULE_TASK: "/clickzetta-dqc/api/v1/dqc/stat/statRuleTask",
} as const

export type DqcOperator =
  | "EQUAL"
  | "NOT_EQUAL"
  | "LESS_THAN"
  | "LESS_EQUAL"
  | "GREATER_THAN"
  | "GREATER_EQUAL"

export type DqcTriggerType = "REST" | "PLAN" | "SCHEDULE_TASK"

// Backend trigger fields (RuleUpdateReq). Fields not part of the current trigger
// type are set to null so a full-object update clears stale residue when switching.
export interface DqcTrigger {
  triggerType: DqcTriggerType
  triggerCron: string | null
  mainSchedulerTaskId: number | null
  subSchedulerTaskId: number | null
  level: number | null
}

export interface ListDqcRulesParams {
  projectId: number
  fuzzyObjectName?: string
  pageNum?: number
  pageSize?: number
}

export function listDqcRules(config: StudioConfig, params: ListDqcRulesParams) {
  return studioRequest(config, API.LIST, {
    pageSize: params.pageSize ?? 10,
    pageNum: params.pageNum ?? 1,
    datasourceType: "LakeHouse",
    projectId: params.projectId,
    workspaceId: params.projectId,
    sortBy: "create_time",
    ...(params.fuzzyObjectName ? { fuzzyObjectName: params.fuzzyObjectName } : {}),
  })
}

export interface CreateDqcSqlRuleParams {
  projectId: number
  objectName: string
  definedSql: string
  checkerInfo: string
  vcluster: string
  owner: string
  desc?: string
  condition?: string
  timeout?: number
  trigger: DqcTrigger
}

export function createDqcSqlRule(config: StudioConfig, params: CreateDqcSqlRuleParams) {
  const body: Record<string, unknown> = {
    datasourceType: "LakeHouse",
    name: "rule",
    workspaceName: config.workspaceName,
    workspaceId: params.projectId,
    objectName: params.objectName,
    condition: params.condition ?? null,
    owner: params.owner,
    desc: params.desc ?? "Auto-generated DQC SQL rule",
    paramValues: "[]",
    checkerInfo: params.checkerInfo,
    objectType: "TABLE",
    tagType: 2,
    tagCode: "defined_sql",
    columnName: null,
    vcluster: params.vcluster,
    timeout: params.timeout ?? 10,
    definedSql: params.definedSql,
    triggerType: params.trigger.triggerType,
  }
  if (params.trigger.triggerCron != null) body.triggerCron = params.trigger.triggerCron
  if (params.trigger.mainSchedulerTaskId != null) body.mainSchedulerTaskId = params.trigger.mainSchedulerTaskId
  if (params.trigger.subSchedulerTaskId != null) body.subSchedulerTaskId = params.trigger.subSchedulerTaskId
  if (params.trigger.level != null) body.level = params.trigger.level
  return studioRequest(config, API.ADD, body, { workspaceName: config.workspaceName })
}

// Read a rule's full object (for read-modify-write update). GET ?ruleId=.
export function getDqcRule(config: StudioConfig, ruleId: number) {
  return studioRequest(config, `${API.GET}?ruleId=${ruleId}`, undefined, undefined, "GET")
}

// Full-object update (read-modify-write). Backend /rule/update expects the whole
// object; partial updates do not take effect for fields like vcluster.
export function updateDqcRuleFull(config: StudioConfig, payload: Record<string, unknown>) {
  return studioRequest(config, API.UPDATE, payload)
}

export function runDqcRule(
  config: StudioConfig,
  ruleId: number,
  triggerType: "TEST" | "REST" = "TEST",
  rerun = false,
) {
  return studioRequest(config, API.RUN, {
    ruleId,
    triggerType,
    rerun: rerun ? 1 : 0,
  })
}

export function deleteDqcRule(config: StudioConfig, ruleId: number) {
  return studioRequest(config, `${API.DELETE}?ruleId=${ruleId}`, undefined, undefined, "GET")
}

export function getDqcStatistics(config: StudioConfig, statType: "rule_table" | "rule_task") {
  const path = statType === "rule_table" ? API.STAT_RULE_TABLE : API.STAT_RULE_TASK
  return studioRequest(config, path, undefined, undefined, "GET")
}
