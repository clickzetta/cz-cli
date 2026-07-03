## Why

Studio workspace 参数已经成为 ADF 迁移和手工运维都需要的公共能力。此前相关约束只记录在 `dataworks-spec` 的迁移 change 中，但 `workspace-param` 是 `cz-cli` 自己暴露的 Studio 命令面，必须在本仓库 OpenSpec 中落地，避免后续命令、SDK 或 help 覆盖漂移。

## What Changes

- 新增 `cz-cli workspace-param` 顶层命令族，覆盖 Studio workspace 参数的 `list`、`add`、`update`、`enable`、`disable` 和 `delete`。
- 新增 SDK 封装，调用 Studio workspace 参数接口：`/list`、`/add`、`/update`、`/publish`、`/offline`、`/delete`。
- 命令默认从当前 Studio workspace 上下文解析 `projectId`，同时允许用户显式传入 `--project-id`。
- `update` 必须携带参数 id、key、value、source type 和 encrypt；`enable`、`disable`、`delete` 必须按参数 id 操作。
- `disable` 和 `delete` 使用 Studio 实测需要的 `paramIds: [id]` 请求体，不使用单个 `id` 字段。
- 将 `workspace-param` 纳入 CLI 顶层路由和 help coverage，确保公开命令可发现且 help 不需要真实 profile。

## Capabilities

### New Capabilities
- `studio-workspace-parameters`: Studio workspace 参数 SDK 和 CLI 生命周期命令，覆盖请求体、project id 解析、输出、错误和真实 smoke 验证要求。

### Modified Capabilities
- `cli-command-routing`: 新增 `workspace-param` 顶层命令应被 CLI 路由识别，并出现在 `cz-cli --help` 中。
- `help-coverage`: 新增 `workspace-param` 命令族的 help 覆盖要求。

## Impact

- `packages/clickzetta-sdk/src/studio/workspace-params.ts`: 新增 Studio workspace 参数 API 封装。
- `packages/clickzetta-sdk/src/index.ts`: 导出 workspace 参数 SDK。
- `packages/cz-cli/src/commands/workspace-param.ts`: 新增 CLI 命令族。
- `packages/cz-cli/src/register-commands.ts`: 注册顶层命令。
- `packages/clickzetta-sdk/test/workspace-params.test.ts`: 覆盖 SDK 请求构造。
- `packages/cz-cli/test/e2e-help/core-cases.ts`: 覆盖 help 可发现性。
- Studio API: `/ide-admin/v1/workspaceParams/list`、`/add`、`/update`、`/publish`、`/offline`、`/delete`。
