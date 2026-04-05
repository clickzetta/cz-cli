## Context

当前 `cz-cli` 仅覆盖 Lakehouse SQL/对象管理，不覆盖 Studio 调度任务开发与运维。`cz-mcp-server` 已具备大量 Studio tools 和参数归一化能力，但 CLI 侧尚未形成统一命令与参数语义。

已确认事实：
- 命令入口仅保留 `cz-cli` 与 `clickzetta-cli`
- 需要支持 task/runs/flow 全链路
- `online/offline/stop` 必须二次确认，支持 `-y`
- `task list` / `runs list` 默认只查第一页，但必须支持翻页参数
- CLI 必须严格读取 Tool 的 `inputSchema`（type/required/default/additionalProperties）
- 先补齐 MCP tools，再做 CLI 对接

## Goals / Non-Goals

### Goals

- 建立 Studio 调度任务在 CLI 的 AI 友好能力：task/runs/flow
- 定稿认证优先级，避免 PAT 与 username/password 语义不一致
- 建立统一分页体验：默认第一页 + 显式翻页 + `ai_message` 提示
- 建立 destructive 操作确认约束：交互确认 + `-y`
- 建立 schema-driven 调用模型：CLI 以 MCP Tool.inputSchema 为单一事实来源

### Non-Goals

- 本变更不新增 Studio 后端业务语义，只对现有 API 做工具化封装
- 本变更不在 OpenSpec 阶段实现业务代码

## Decisions

### Decision 1: 命令入口统一

仅支持：
- `cz-cli`
- `clickzetta-cli`

不再使用其他命令名变体，以避免 AI 提示和用户文档歧义。

### Decision 2: 认证优先级定稿

最终优先级：
1. CLI 参数 `--pat`
2. 环境变量 `CZ_PAT`
3. profile `pat`
4. CLI 参数 `--username/--password`
5. 环境变量 `CZ_USERNAME/CZ_PASSWORD`
6. profile `username/password`

规则：
- PAT 与 username/password 互斥
- 若同时出现，按优先级选择并输出 `auth_mode` 诊断信息

### Decision 3: MCP-first 交付顺序

先在 `cz-mcp-server` 补齐并注册完整 tool，再在 CLI 对接：
- `offline_task`
- `offline_task_with_downstream`
- `kill_task_instance`
- （如需区分于 publish）`online_task`

每个 tool 必须具备严格 `input_schema`，包含：
- `type`
- `properties`
- `required`
- `additionalProperties`

### Decision 4: CLI 采用 schema-driven 调用

CLI 不直接“按 handler 参数习惯”调用，而是：
1. 获取目标 tool 的 `inputSchema`
2. 将用户输入 + 派生参数合并
3. 按 schema 做 default/required/type/unknown-field 校验
4. 通过后再调用 tool

收益：
- 强一致性（CLI 与 MCP 参数契约一致）
- 错误更早暴露（调用前失败）
- 便于未来自动生成命令帮助

### Decision 5: 分页策略统一（task list / runs list）

策略：
- 默认 `page=1`
- 默认 `page_size` 采用 tool schema 默认值
- 保留 `--page` / `--page-size`
- 返回新增 `ai_message`，格式固定：
  - 当前第几页
  - 当前页条数
  - 总条数/总页数（可得时）
  - 下一页命令示例

示例：
`ai_message: "当前仅展示第 1 页（20 条 / 共 136 条）。如需继续翻页，请执行: cz-cli runs list --page 2 --page-size 20"`

### Decision 6: runs detail 改为精确 API

`runs detail RUN_ID` 优先调用 `get_task_instance_detail(task_instance_id=RUN_ID)`，不再依赖 `task_name_or_id` 模糊匹配。

说明：
- `task_name_or_id` 的模糊风险可接受，但应保留在“搜索/列表”语义，而非“详情”语义。

### Decision 7: destructive 操作确认合同

覆盖命令：
- `task online`
- `task offline`
- `task offline --with-downstream`
- `runs stop`

行为：
- 未指定 `-y`：必须弹出二次确认
- 指定 `-y`：直接执行

`task offline` 确认文案必须包含业务规则：
- 仅当周期任务不存在下游依赖时可直接下线
- 若需连同下游下线，使用“下线（含下游）”
- 下线后会清理历史/未运行实例且不可恢复

### Decision 8: Flow 命令设计

CLI 增加 `task flow` 子命令，映射 MCP 现有 flow tools：
- `task flow dag`
- `task flow create-node`
- `task flow remove-node`
- `task flow bind`
- `task flow unbind`
- `task flow node-detail`
- `task flow node-save`
- `task flow node-save-config`
- `task flow submit`
- `task flow instances`

原则：
- 优先使用 `node_name`（AI 友好）
- `node_id` / `dependency_id` 由 `get_flow_dag` 派生，必要时再显式输入

### Decision 9: 参数去冗余（AI 优化）

CLI 不暴露或弱化以下冗余参数：
- `project_id` / `workspace_id` / `tenant_id` / `user_id`（从连接上下文推导）
- `runs log` 的 `execution_id`（先 `list_executions` 自动取最新）
- `task online` 的 `task_version`（先 `get_task_detail` 推导）
- `task save` 的 `param_value_list`（默认补空数组）

### Decision 10: API 映射约束

周期任务生命周期映射固定：
- `task offline` -> `DELETE_TASK`
- `task offline --with-downstream` -> `OFFLINE_TASK_WITH_DOWNSTREAM`
- `runs stop` -> `KILL_TASK_INSTANCE`

### Decision 11: 共性参数解析采用共享 resolver

为避免“同一语义在不同命令重复实现后漂移”，CLI 引入共享解析层（resolver）：
- `task_name_or_id` 统一解析到 `task_id`
- `run_id_or_task_name` 统一解析到 `task_run_id`
- “按任务名解析最新 run”统一采用跨 `task_run_type={1,3,4}` 的策略

约束：
- `runs` 与 `executions` 相关命令必须复用共享 resolver，不允许局部复制一套解析逻辑
- 共享 resolver 必须配套单测，覆盖歧义、空结果、跨类型选择最新实例

## Risks and Mitigations

### Risk 1: MCP 与 CLI schema 漂移

- 风险：CLI 参数验证与 MCP Tool.inputSchema 不一致
- 缓解：CLI 启动时以 tool schema 生成参数元信息；CI 增加 schema 契约测试

### Risk 2: destructive 操作误触发

- 风险：AI 自动调用造成误下线/误停止
- 缓解：强制二次确认 + `-y` 明确绕过 + 明确风险提示文案

### Risk 3: 分页误解导致“漏数据”

- 风险：用户以为第一页即全量
- 缓解：统一 `ai_message`，显式告知当前页与翻页命令

### Risk 4: 联调环境不可达

- 风险：外网/DNS 问题导致真实 tool_result 无法回放
- 缓解：先跑本地 schema/normalizer/handler 结构验证；网络恢复后补录真实链路

### Risk 5: 多命令重复实现导致回归扩散

- 风险：同类参数解析在多个命令里各写一份，修复一处漏一处
- 缓解：共享 resolver + 覆盖 runs/executions/task 的契约单测

## Migration Plan

1. 在 `cz-mcp-server` 新增并注册缺失 lifecycle tools，完善 schema
2. 对现有 tools 的 required/default 做一致性审查（特别是 list 类分页字段）
3. 在 CLI 实现 schema-driven 调用层与参数派生层
4. 落地 task/runs/flow 命令与 destructive 确认交互
5. 更新 ai-guide 与 skill 文档
6. 补齐真实环境集成测试（串行场景链路）与联调回放用例
