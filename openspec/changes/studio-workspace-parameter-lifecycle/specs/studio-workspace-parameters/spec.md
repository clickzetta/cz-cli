## ADDED Requirements

### Requirement: Studio workspace 参数 SDK
系统 SHALL 在 `@clickzetta/sdk` 中封装 Studio workspace 参数 API，并保持请求体与 Studio 实测契约一致。

#### Scenario: 查询 workspace 参数
- **WHEN** 调用 SDK 查询 workspace 参数
- **THEN** SDK SHALL 请求 `/ide-admin/v1/workspaceParams/list`
- **AND** 请求体 SHALL 包含 `projectId`、`pageIndex` 和 `pageSize`

#### Scenario: 新增 workspace 参数
- **WHEN** 调用 SDK 新增 workspace 参数
- **THEN** SDK SHALL 请求 `/ide-admin/v1/workspaceParams/add`
- **AND** 请求体 SHALL 包含 `projectId`、`paramKey`、`paramValue`、`sourceType` 和 `encrypt`

#### Scenario: 更新 workspace 参数
- **WHEN** 调用 SDK 更新 workspace 参数
- **THEN** SDK SHALL 请求 `/ide-admin/v1/workspaceParams/update`
- **AND** 请求体 SHALL 包含 `projectId`、参数 `id`、`paramKey`、`paramValue`、`sourceType` 和 `encrypt`

#### Scenario: 启用 workspace 参数
- **WHEN** 调用 SDK 启用 workspace 参数
- **THEN** SDK SHALL 请求 `/ide-admin/v1/workspaceParams/publish`
- **AND** 请求体 SHALL 包含 `projectId` 和参数 `id`

#### Scenario: 停用或删除 workspace 参数
- **WHEN** 调用 SDK 停用或删除 workspace 参数
- **THEN** 停用 SHALL 请求 `/ide-admin/v1/workspaceParams/offline`
- **AND** 删除 SHALL 请求 `/ide-admin/v1/workspaceParams/delete`
- **AND** 两个请求体 SHALL 包含 `projectId` 和 `paramIds: [id]`
- **AND** 请求体 SHALL NOT 使用单个 `id` 字段替代 `paramIds`

### Requirement: workspace-param CLI 生命周期命令
系统 SHALL 暴露 `cz-cli workspace-param` 顶层命令族，用于管理 Studio workspace 参数的完整生命周期。

#### Scenario: 查询和新增参数
- **WHEN** 用户执行 `cz-cli workspace-param list --format json`
- **THEN** CLI SHALL 使用当前 Studio context 的 project id 或 `--project-id` 覆盖值查询参数
- **WHEN** 用户执行 `cz-cli workspace-param add --key k --value v --source-type 0 --encrypt 0 --format json`
- **THEN** CLI SHALL 调用新增参数 API 并返回 Studio API 的 `data`

#### Scenario: 更新参数
- **WHEN** 用户执行 `cz-cli workspace-param update --id 157 --key k --value v2 --source-type 0 --encrypt 0 --format json`
- **THEN** CLI SHALL 校验 `--id` 为正数
- **AND** CLI SHALL 调用更新参数 API
- **AND** 请求 SHALL 使用命令传入的 key、value、source type 和 encrypt

#### Scenario: 启用停用删除参数
- **WHEN** 用户执行 `cz-cli workspace-param enable --id 157`
- **THEN** CLI SHALL 调用 publish API
- **WHEN** 用户执行 `cz-cli workspace-param disable --id 157`
- **THEN** CLI SHALL 调用 offline API
- **WHEN** 用户执行 `cz-cli workspace-param delete --id 157`
- **THEN** CLI SHALL 调用 delete API

#### Scenario: 参数 id 无效
- **WHEN** 用户对 `update`、`enable`、`disable` 或 `delete` 传入非正数 `--id`
- **THEN** CLI SHALL 返回对应子命令的业务错误
- **AND** CLI SHALL NOT 调用 Studio API

#### Scenario: project id 无效
- **WHEN** 当前 Studio context 缺少有效 project id 且用户未传入有效 `--project-id`
- **THEN** CLI SHALL 返回业务错误
- **AND** CLI SHALL NOT 调用 Studio API

### Requirement: 真实 Studio 生命周期 smoke
系统 SHALL 为 workspace 参数生命周期提供可重复的真实 profile smoke 验证步骤，并避免持久化敏感信息。

#### Scenario: 完整生命周期 smoke
- **WHEN** 维护者使用已配置 profile 创建唯一临时 workspace 参数
- **THEN** smoke SHALL 依次验证 `add`、`list`、`update`、`enable`、`disable`、`delete`
- **AND** 最终 `list` SHALL 确认临时参数不存在

#### Scenario: smoke 清理
- **WHEN** smoke 在创建参数后失败
- **THEN** smoke SHALL 尝试对已创建参数执行 `disable` 和 `delete`
- **AND** 仓库文件 SHALL NOT 保存 token、cookie、session id 或临时 smoke key
