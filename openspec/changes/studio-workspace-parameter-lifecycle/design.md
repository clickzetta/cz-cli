## Context

Studio workspace 参数是 Studio 项目级公共参数，不等同于 Lakehouse workspace 切换命令。ADF 迁移会把工厂全局参数映射到 Studio workspace 参数；同时用户也需要独立运维这些参数的启用、停用、更新和删除。

当前 `cz-cli` 已有 Studio profile/context 解析能力，能够从 profile 得到 token、实例、workspace、projectId 等调用 Studio API 所需上下文。workspace 参数接口使用 `projectId` 而不是 workspace 名称作为主定位字段，因此命令必须明确处理 `projectId` 默认值和显式覆盖。

## Goals / Non-Goals

**Goals:**
- 在 SDK 中封装 Studio workspace 参数的 list/add/update/publish/offline/delete API。
- 暴露 `cz-cli workspace-param` 顶层命令族，支持完整生命周期操作。
- 将 `workspace-param` 纳入顶层路由和 help coverage，避免隐藏命令或未测 help 漂移。
- 保留真实接口请求体差异，尤其是停用和删除使用 `paramIds` 数组。
- 通过单元测试、help 测试和真实 profile smoke 验证命令可用。

**Non-Goals:**
- 不在该命令里实现批量更新、批量启停或批量删除。
- 不改变 `workspace` 命令族语义；`workspace` 仍表示 Lakehouse workspace 切换和查看。
- 不在测试或 OpenSpec 中固化用户 token、cookie、session id 或一次性 smoke 参数 key。
- 不把 ADF 迁移 writer 的自动 upsert 流程扩展为自动启停删；迁移 writer 只需要 list/add，生命周期操作由用户显式执行。

## Decisions

1. 新增独立顶层命令 `workspace-param`，不挂在 `workspace` 下。
   - `workspace` 已用于 Lakehouse workspace 管理；Studio workspace 参数是项目级配置对象，混入 `workspace` 会造成命令语义歧义。
   - 顶层命令也便于迁移 writer 通过 `cz-cli workspace-param list/add` 调用。

2. SDK 使用薄封装，不隐藏 Studio API 字段。
   - `listWorkspaceParams` 请求 `/ide-admin/v1/workspaceParams/list`，请求体包含 `projectId`、`pageIndex`、`pageSize`。
   - `addWorkspaceParam` 请求 `/add`，请求体包含 `projectId`、`paramKey`、`paramValue`、`sourceType`、`encrypt`。
   - `updateWorkspaceParam` 请求 `/update`，请求体包含 `projectId`、`id`、`paramKey`、`paramValue`、`sourceType`、`encrypt`。
   - `enableWorkspaceParam` 请求 `/publish`，请求体包含 `projectId`、`id`。
   - `disableWorkspaceParam` 请求 `/offline`，请求体包含 `projectId`、`paramIds: [id]`。
   - `deleteWorkspaceParam` 请求 `/delete`，请求体包含 `projectId`、`paramIds: [id]`。

3. CLI 默认从 Studio context 取 `projectId`，但所有子命令都允许 `--project-id` 覆盖。
   - 默认值满足日常 profile 使用。
   - 显式 `--project-id` 满足多项目或自动化场景。
   - `--project-id` 和 `--id` 必须校验为正数，避免发送无意义请求。

4. 状态变更命令必须由用户显式调用。
   - `enable`、`disable`、`delete` 不作为 `add` 或 `update` 的隐式副作用。
   - `delete` 暂不增加额外交互确认，因为 CLI 命令本身就是明确的 destructive intent；自动化场景需要非交互可用。

5. 输出保持通用 `success/error` 格式。
   - `--format json` 直接返回 Studio API 的 `data`，便于脚本消费。
   - 错误码按子命令区分，例如 `WORKSPACE_PARAM_UPDATE_FAILED`，便于自动化定位失败阶段。

## Risks / Trade-offs

- Studio API 请求体不一致导致实现猜错 -> 用 SDK request-construction 测试固定每个端点请求体，并用真实 profile smoke 覆盖 add/update/enable/disable/delete。
- `projectId` 来源不清晰 -> 命令默认使用 `getStudioContext` 中的当前 workspace project，同时支持 `--project-id` 覆盖。
- 真实 smoke 可能污染用户项目 -> smoke 必须创建唯一临时 key，成功或失败都尝试停用和删除。
- 用户粘贴 token 或一次性参数 key 可能被误写入仓库 -> 测试和文档只记录接口字段与行为，不保存 token、cookie、session id 或 smoke key。

## Migration Plan

1. 添加 SDK 封装和请求构造测试。
2. 添加 `workspace-param` 命令处理、顶层注册和 help coverage。
3. 用本地源码 CLI 通过配置 profile 做真实生命周期 smoke。
4. 保留 `dataworks-spec` 迁移 writer 中的 list/add 调用，但把完整生命周期契约以本 change 为准。

Rollback 方式是移除 `registerWorkspaceParamCommand` 注册和对应 SDK 导出；已创建的 Studio workspace 参数不受 CLI 代码回滚影响。
