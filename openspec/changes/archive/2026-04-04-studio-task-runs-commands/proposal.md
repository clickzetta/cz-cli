## Why

`cz-cli` 已覆盖 SQL 与数据对象管理，但仍缺 Studio 调度任务开发/运维闭环。AI 场景下缺少统一的 task/runs/flow 命令、PAT 认证优先级明确规则、以及 destructive 操作确认机制，导致可用性和安全性都不足。

## What Changes

- 新增 `cz-cli task` 命令组：任务定义管理（folders/list/detail/save/save-config/online/offline/offline-with-downstream）
- 新增 `cz-cli runs` 命令组：运行实例运维（list/detail/log/stop/refill/stats）
- 新增 `cz-cli task flow` 子命令集：Flow 任务结构与节点运维（dag/create-node/remove-node/bind/unbind/node-detail/node-save/node-save-config/submit/instances）
- 明确仅支持两个命令名入口：`cz-cli` 与 `clickzetta-cli`
- 认证优先级定稿：`--pat` > `CZ_PAT` > profile `pat` > `--username/--password` > `CZ_USERNAME/CZ_PASSWORD` > profile username/password
- `task list` 与 `runs list` 默认查询第一页，同时保留分页参数供翻页；返回体新增 `ai_message` 明确“当前仅展示第 N 页”
- `online` / `offline` / `offline-with-downstream` / `runs stop` / `runs refill` 全部二次确认；支持 `-y` 跳过确认
- CLI 侧严格以 MCP `Tool.inputSchema` 为准（类型、required、default、additionalProperties），禁止仅按 handler 参数约定调用
- 落地顺序调整为：先在 `cz-mcp-server` 实现完整 tools（含 schema），再在 CLI 对接
- 新增“共性回归防线”：共享 resolver（task/run 解析）、统一取消语义、空数据健壮性处理与契约回归测试

## Capabilities

### New Capabilities
- `task-management`: Studio 周期任务定义管理（含上线/下线/下线含下游）
- `runs-management`: Studio 周期任务实例运维（含停止实例）
- `flow-management`: Studio Flow 任务结构与节点管理

### Modified Capabilities
- `profile-management`: PAT 认证输入与互斥规则
- `connection-management`: PAT/用户名密码统一连接解析及优先级
- `ai-guide`: task/runs/flow 命令文档与确认/分页语义

## Impact

**MCP server 影响（先实施）**
- 新增任务生命周期 tools：`offline_task`、`offline_task_with_downstream`、`kill_task_instance`（必要时补 `online_task`）
- 每个 tool 提供严格 `input_schema`：`type`、`required`、`additionalProperties`
- 保持工具可被 `ArgumentNormalizer` 正确处理

**CLI 影响（后实施）**
- 新增 task/runs/flow 命令组
- 新增 destructive 操作交互确认与 `-y` 快捷执行
- CLI 调用链改为 schema-driven（读取 tool schema 后组装/校验参数）
- 对可推导参数做最小化输入设计，避免把下游必填字段全部暴露给用户

## Testing Scope

- OpenSpec 文档层：需求、设计、任务拆解一致性
- MCP 工具层：schema 校验、required/default 补齐、错误语义
- CLI 层：分页提示、确认提示、参数派生链路
- 端到端联调：待网络可用时补跑真实 tool call / tool_result 录制场景
