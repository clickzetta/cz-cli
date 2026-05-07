---
name: job-performance-analyzer
description: Clickzetta Job 性能自动诊断工具。分析执行计划和运行概况，自动识别性能瓶颈并给出参数优化建议。支持增量计算(REFRESH)、AP模式、GP模式、Compaction等各类SQL场景。通常需要明确的 job_id 或性能分析诉求。若用户意图是“执行 SQL”（例如 `OPTIMIZE schema.table`、`帮我手动执行 OPTIMIZE`），不要触发本 skill，应改用 SQL 执行相关工具。
---

# Job Performance Analyzer

## 概述

自动诊断 Clickzetta Job 性能问题的工具，分析执行计划和运行概况，识别瓶颈并给出参数优化建议。

## 已实现规则

**Stage/Operator 级别优化** (9条规则):
- `refresh_type_detection` - 增量/全量刷新判断
- `single_dop_aggregate` - 单并行度聚合优化（三阶段聚合、Bloom Filter 收集检测）
- `hash_join_optimization` - Broadcast Hash Join 优化
- `tablesink_dop` - TableSink DOP 自动调整检测
- `max_dop_check` - 最大 DOP 限制提示
- `spilling_analysis` - 内存溢出分析
- `skew_detection` - 数据倾斜检测
- `resource_efficiency_analysis` - 资源效率分析（对比实际耗时与理论资源充足预期耗时）
- `active_problem_finding` - 主动瓶颈分析

**状态表优化** (6条规则):
- `non_incremental_diagnosis` - 全量刷新原因诊断
- `row_number_check` - ROW_NUMBER=1 pattern 检查
- `append_only_scan` - Append-Only 表识别
- `state_table_enable` - 状态表启用建议
- `aggregate_reuse` - 聚合结果复用检查
- `heavy_calc_state` - 高耗时 Calc 状态优化

### Usage

MCP Tool Call 示例

#### 基本分析（仅 Stage/Operator 级别优化，默认）
```json
{
  "name": "fetch_job_performance_data",
  "arguments": {
    "workspace_name": "your_workspace",
    "job_id": "2026012808001805432z9g3fx1sok"
  }
}
```

如果结果是“未发现需要调整的参数”，则表示当前作业性能良好，无需进一步优化。

#### quick 模式（默认，纯规则引擎，零 AI 消耗）
```json
{
  "name": "fetch_job_performance_data",
  "arguments": {
    "workspace_name": "your_workspace",
    "job_id": "2026012808001805432z9g3fx1sok"
  }
}
```
- 不传 `analysis_mode` 或传 `"quick"` 均为此模式
- 纯规则引擎分析，不消耗 AI token，适合日常巡检和批量扫描
- 输出内容：概况 + 参数建议 + 关键洞察（仅 `important` 级别，如资源效率分析）
- 不输出 findings 详情和 detail 级别 insights（需要可切换 standard 模式）
- 如果结果是"未发现需要调整的参数"且无关键洞察，表示当前作业性能良好

#### Standard 模式（详细分析，规则引擎 + AI 研判数据）
```json
{
  "name": "fetch_job_performance_data",
  "arguments": {
    "workspace_name": "your_workspace",
    "job_id": "2026012808001805432z9g3fx1sok",
    "analysis_mode": "detailed"
  }
}
```

#### Expert 模式（深度分析，需用户确认）
```json
{
  "name": "fetch_job_performance_data",
  "arguments": {
    "workspace_name": "your_workspace",
    "job_id": "2026012808001805432z9g3fx1sok",
    "analysis_mode": "expert"
  }
}
```

**参数说明**：
- `workspace_name` (必需): 工作空间名称
- `job_id` (必需): 作业ID
- `user_id` (可选): 用户ID，默认使用当前用户
- `analysis_mode` (可选): 分析模式，默认 `quick`
  - `quick` — 纯规则引擎，零 AI 消耗，适合日常巡检
  - `detailed` — 规则引擎 + AI 研判数据（含 analysis_scope、stage_summary、全部 findings/insights），适合排查问题
  - `expert` — 深度分析，按需加载 reference 文档，消耗较多 token。返回 `requires_confirmation=true` 和 `token_estimate`

**分析模式说明**：
- `quick`（默认）：与现有行为完全一致，findings 过滤掉 INFO/LOW 级别，insights 仅输出 important 级别
- `detailed`：输出全部 findings/insights + analysis_scope（规则引擎中间计算数据），附带 AI 研判 prompt
- `expert`：在 detailed 基础上，根据 findings 类型自动加载对应的 reference 文档（如 stage-operator-optimization.md、state-table-optimization.md），供 AI 做深度根因分析和优化方案设计

**工具功能**：
1. 自动获取job plan和job profile数据
2. 调用性能分析器进行分析
3. 返回优化建议和诊断结果


### 用户意图映射

当 AI 调用此工具时，根据用户的自然语言严格按关键词选择分析模式（不要自行升级）：

1. **quick 模式**（默认，纯规则引擎）— 用户没有明确要求"详细"或"专家"时一律用 quick：
   - "帮我分析 job xxx"
   - "快速看看 job xxx 有没有问题"
   - "给出任务 xxx 的优化建议"
   - "再分析下这个 job"

2. **detailed 模式**（详细分析，仔细分析，规则引擎 + AI 研判）— 仅当用户说"详细"或"仔细"时：
   - "帮我详细分析 job xxx"
   - "再详细分析下这个 job"
   - "仔细看看 job xxx 的性能问题"

3. **expert 模式**（专家分析，需用户确认 token 消耗）— 仅当用户原话包含"专家模式"、"深度分析"或"全面分析"时：
   - "用专家模式分析 job xxx"
   - "深度分析 job xxx"
   - "帮我全面分析 job xxx"
   - ⚠️ 注意："详细分析"是 detailed，不是 expert

3. **不适用场景（禁止触发本 skill）**：
   - "OPTIMIZE test_schema.test_vector_batch_1773819304920;"
   - "OPTIMIZE sql帮我手动执行一下"
   - 以上属于 SQL 执行请求，不是 Job 性能诊断，请走 SQL 执行工具

**⚠️ 重要说明**：
- 优化参数推荐必须遵守的原则 `references/optimization-principles.md`

## 架构设计

### 包结构
```
.
├── SKILL.md
├── references
    ├── references/optimization-principles.md
```

## 参考文档 （下面文档仅用于开发skills的script时使用）
- `references/data-extraction-paths.md` - JSON 路径参考，使用skill时不需要
- `references/core-specification.md` - 核心数据提取规范，使用skill时不需要
- `references/incremental-optimization.md` - 增量计算优化入口文档（导航到以下文档），使用skill时不需要
  - `references/stage-operator-optimization.md` - Stage/Operator 级别优化，使用skill时不需要
  - `references/incremental-algorithm-analysis.md` - 增量算法分析，使用skill时不需要
  - `references/state-table-optimization.md` - 状态表优化，使用skill时不需要
  - `references/optimization-principles.md` - 参数推荐原则

-- 以下是为了迭代/重新创建skill时使用，正常使用skill时不需要关注以下references
- `references/original_prompt.md` - 原始需求，使用skill时不需要
- `references/skill_architecture.md` - skill架构设计，使用skill时不需要
- `references/recreate-skill-rule.md` - 重新创建skill规则，使用skill时不需要
