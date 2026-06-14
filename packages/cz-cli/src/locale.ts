const ZH_RE = /^zh[_-]/i

export function isChineseLocale(): boolean {
  const lang = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || ""
  return ZH_RE.test(lang.trim())
}

type MessageKey =
  | "task_content"
  | "task_deps"
  | "task_save_online_reminder"
  | "runs_detail"
  | "runs_detail_degraded"
  | "runs_deps"
  | "runs_refill"
  | "pagination"
  | "offline_confirm"
  | "online_confirm"
  | "stop_confirm"
  | "refill_confirm"
  | "execute_confirm"
  | "flow_submit_confirm"
  | "task_search_result"
  | "task_stats_result"

const MESSAGES: Record<MessageKey, [zh: string, en: string]> = {
  task_content: [
    "这是草稿态数据(content + schedule config + params)。params 字段包含任务参数列表，paramType=system 表示系统内置参数或时间表达式，paramType=manual 表示常量。",
    "This is draft data (content + schedule config + params). The params field lists task parameters; paramType=system means a built-in system param or time expression, paramType=manual means a constant value.",
  ],
  task_deps: [
    "这是草稿态依赖关系。",
    "This is draft dependency data." +
    "",
  ],
  task_save_online_reminder: [
    "草稿已保存（task_id={0}）。注意：调度尚未激活。请在用户明确要求发布后，再执行: cz-cli task online {0} -y",
    "Draft saved (task_id={0}). Note: schedule is not active. Run: cz-cli task online {0} -y when ready to publish.",
  ],
  runs_detail: [
    "这是调度态数据（run instance + published schedule config）。草稿态数据请使用 cz-cli task content。",
    "This is scheduled data (run instance + published config). For draft data, use cz-cli task content.",
  ],
  runs_detail_degraded: [
    "注意：未能获取完整调度配置，已返回运行实例基础信息。",
    "Note: could not fetch full schedule config; returning basic run instance info.",
  ],
  runs_deps: [
    "这是调度态运行时依赖关系。草稿态依赖请使用 cz-cli task config.",
    "This is task run dependency data. For task dependencies, use cz-cli task config.",
  ],
  runs_refill: [
    "补数任务已提交（run_id={0}）。已归一化: backfill_task_id 即本次补数运行实例 run_id。可使用 cz-cli runs logs {0} 查看执行日志。",
    "Backfill submitted (run_id={0}). Normalized: backfill_task_id is this run_id. Use cz-cli runs logs {0} to view logs.",
  ],
  pagination: [
    "当前仅展示第 {0} 页（{1} 条 / 共 {2} 条）。如需下一页，请执行: {3}",
    "Showing page {0} ({1} of {2} total). Next page: {3}",
  ],
  offline_confirm: [
    "确认将任务下线？此操作不可逆，将清除调度历史。",
    "Confirm taking task offline? This is irreversible and clears schedule history.",
  ],
  online_confirm: [
    "确认发布任务？发布后调度将立即生效。",
    "Confirm publishing task? The schedule will take effect immediately.",
  ],
  stop_confirm: [
    "确认停止该运行实例？",
    "Confirm stopping this run instance?",
  ],
  refill_confirm: [
    "确认提交补数任务？这将重新运行历史数据。",
    "Confirm submitting backfill? This will re-run historical data.",
  ],
  execute_confirm: [
    "确认立即执行该任务？",
    "Confirm executing this task now?",
  ],
  flow_submit_confirm: [
    "确认提交 Flow？",
    "Confirm submitting this Flow?",
  ],
  task_search_result: [
    "找到 {0} 个匹配任务{1}。path 字段为解析后的文件夹路径。如需更多结果请增大 --limit。",
    "Found {0} matching tasks{1}. The path field shows the resolved folder path. Use --limit to increase results.",
  ],
  task_stats_result: [
    "任务统计（{0}）：共 {1} 个任务，{2} 个目录。运行实例（{3}）共 {4} 次，成功 {5} / 失败 {6} / 运行中 {7}。",
    "Task stats ({0}): {1} tasks, {2} folders. Run instances ({3}): {4} total, {5} succeeded / {6} failed / {7} running.",
  ],
}

export function t(key: MessageKey, ...args: (string | number)[]): string {
  const pair = MESSAGES[key]
  const template = isChineseLocale() ? pair[0] : pair[1]
  return template.replace(/\{(\d+)\}/g, (_, idx) => String(args[Number(idx)] ?? ""))
}

export function paginationMessage(
  page: number,
  count: number,
  total: number,
  nextCmd: string,
): string {
  return t("pagination", page, count, total, nextCmd)
}
