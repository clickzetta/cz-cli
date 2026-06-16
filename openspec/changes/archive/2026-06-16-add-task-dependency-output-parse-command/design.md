## Context

`task save-cron` 和 `task save-schedule/save-config` 通过 SDK 的 `saveTaskConfig` 调用 `/ide-admin/v1/dataFileConfiguration/saveDataFileConfiguration` 保存调度配置。SQL/集成任务保存调度配置时需要同步保存解析出的调度依赖和任务产出，否则 UI 调度配置可能缺少依赖、产出或执行集群 ID。

Studio 前端使用 `/ide-admin/v1/dataFileConfiguration/parseDataFileDependencyOut` 根据任务内容、任务 ID、项目、工作空间和 schema 解析两类数据：

- `fileOutputTableDTOS`: 当前任务的产出表。
- `dataFileDependencyDTOS`: 当前任务依赖的上游调度任务。

用户关心的字段是名称、工作空间、输出表名、调度周期、开始调度时间、添加方式、依赖策略和产出表。保存接口需要的内部 DTO 字段不作为本命令的主要用户输出。

## Goals / Non-Goals

**Goals:**
- 新增一个 CLI 命令解析 SQL/集成任务的产出表和调度依赖。
- 输出包含人可读字段，便于用户检查解析出的调度依赖和任务产出。
- `task save-cron`、`task save-schedule/save-config` 保存 SQL/集成任务调度配置时自动解析并保存依赖、产出。
- 保存调度配置时解析执行集群 ID，包括 `DEFAULT`。
- 对非 SQL/集成任务返回稳定错误，不调用解析接口。

**Non-Goals:**
- 不在新命令里自动保存调度配置。
- 不改变 `save-cron`、`save-schedule` 的默认保存行为。
- 不要求保存命令消费 `task lineage` 的输出；保存命令自行调用解析接口。
- 不支持 Flow、Python、Shell、JDBC、CDC 等任务类型的解析。
- 不重新实现 SQL 解析逻辑，解析结果以 Studio API 为准。

## Decisions

1. 命令命名为 `task lineage <task>`。
   - 选择该名称是因为 Studio API 名称是 `parseDataFileDependencyOut`，能直接表达“依赖 + 产出”两类结果。
   - 备选 `parse-schedule` 含义过宽，容易被理解为解析 cron 或调度周期。

2. 默认从任务详情读取内容，从调度配置读取 schema。
   - 请求体字段为 `projectId`、`workspaceId`、`schemaName`、`dataFileContent`、`dataFileId`。
   - 命令支持 `--schema` 覆盖 schema，支持 `--content` / `--file` 解析未保存内容。
   - 若任务详情没有内容且用户未传内容，命令仍把空字符串交给解析接口，由服务端决定是否返回空结果或错误。

3. 支持类型仅为 SQL 和集成任务。
   - SQL 任务使用 `fileType=4`。
   - 集成任务使用 `fileType=1`。
   - 类型优先从 `dataFile/getDetail` 的 `fileType` 读取，避免依赖名称推断。

4. 输出面向用户确认，保存流程保持独立。
   - `outputs` 映射 `fileOutputTableDTOS`，重点包含 `output_table_name`、`ref_table_name`、`task_id`、`project_id`、`add_method`、`add_method_name`。
   - `dependencies` 映射 `dataFileDependencyDTOS`，重点包含 `name`、`workspace`、`output_table_name`、`schedule_rate_type`、`schedule_start_time`、`add_method`、`add_method_name`、`dep_strategy`、`dependency_task_id`、`dependency_project_id`。
   - `--format table`、`csv`、`text`、`jsonl` 使用拍平行输出，避免把依赖和产出藏在大 JSON 单元格里。
   - 不输出 `save_payload`。保存命令自行解析并保存依赖/产出，不消费本命令输出。

5. SDK 增加专用解析封装。
   - `parseTaskDependencyOut(config, params)` 负责调用 `/ide-admin/v1/dataFileConfiguration/parseDataFileDependencyOut`。
   - `SaveTaskConfigParams` 支持 `dataFileOutputListReqs?: unknown[]`，用于保存任务产出列表。

6. 保存命令自动解析并保存调度依赖和任务产出。
   - `task save-cron` 保存 cron 时，对 SQL/集成任务调用 `parseDataFileDependencyOut`，把解析出的 `dataFileDependencyDTOS` 和 `fileOutputTableDTOS` 转成保存请求。
   - `task save-schedule/save-config` 保存非 cron 配置时同样自动解析；但用户显式传入 `--deps clear` 或 `--deps replace` 时，依赖列表以用户输入为准，任务产出仍使用解析结果。
   - 保存任务产出时需要携带顶层 `ownerCnName` 和 `ownerEnName`，否则后端插入产出表可能失败。
   - 保存执行集群时，`--vc`、全局 `--vcluster`、旧配置和 `DEFAULT` 依次作为集群 code 来源；只要有集群 code 且没有集群 ID，就尝试解析 `etlVcId`，包括 `DEFAULT`。

## Risks / Trade-offs

- Studio API 返回字段可能随任务类型变化 → CLI 只做薄映射，减少字段丢失风险。
- `depStrategy` 不在解析接口示例中返回 → CLI 在保存字段里默认补 `0`，同时在展示结果里暴露该默认值，后续可由保存命令覆盖。
- 集成任务内容是 JSON 字符串而不是 SQL → 命令不解析内容结构，直接传给 Studio API，行为与前端一致。
- 现有 `save-config` 测试和源码 `save-schedule` 命名不一致 → 本次仅在相关测试触达时维持兼容别名，不扩大重构。
