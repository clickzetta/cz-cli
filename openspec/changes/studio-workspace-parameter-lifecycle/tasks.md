## 1. SDK 封装

- [x] 1.1 在 `packages/clickzetta-sdk/src/studio/workspace-params.ts` 添加 `listWorkspaceParams` 和 `addWorkspaceParam`，请求体包含 `projectId`、分页、key、value、sourceType、encrypt。
- [x] 1.2 在 `packages/clickzetta-sdk/src/studio/workspace-params.ts` 添加 `updateWorkspaceParam`，请求体包含 `projectId`、`id`、`paramKey`、`paramValue`、`sourceType`、`encrypt`。
- [x] 1.3 在 `packages/clickzetta-sdk/src/studio/workspace-params.ts` 添加 `enableWorkspaceParam`、`disableWorkspaceParam`、`deleteWorkspaceParam`，其中 `disable/delete` 使用 `paramIds: [id]`。
- [x] 1.4 在 `packages/clickzetta-sdk/src/index.ts` 导出 workspace 参数 SDK。

## 2. CLI 命令

- [x] 2.1 在 `packages/cz-cli/src/commands/workspace-param.ts` 新增 `workspace-param list` 和 `workspace-param add` 命令，支持 `--project-id` 并默认使用当前 Studio context project id。
- [x] 2.2 在 `packages/cz-cli/src/commands/workspace-param.ts` 新增 `workspace-param update` 命令，校验 `--id` 并传递 key、value、source-type、encrypt。
- [x] 2.3 在 `packages/cz-cli/src/commands/workspace-param.ts` 新增 `workspace-param enable`、`disable`、`delete` 命令，校验 `--id` 并返回对应业务错误码。
- [x] 2.4 在 `packages/cz-cli/src/register-commands.ts` 注册 `registerWorkspaceParamCommand`。

## 3. 测试和 help 覆盖

- [x] 3.1 在 `packages/clickzetta-sdk/test/workspace-params.test.ts` 添加 SDK 请求构造测试，覆盖 list/add/update/enable/disable/delete。
- [x] 3.2 在 `packages/cz-cli/test/e2e-help/core-cases.ts` 添加 `workspace-param` 命令族 help case。
- [x] 3.3 在 `packages/clickzetta-sdk` 运行 `bun test test/workspace-params.test.ts`。
- [x] 3.4 在 `packages/cz-cli` 运行 `bun test ./test/e2e-help.ts`。

## 4. 真实 Studio 验证和 OpenSpec 校验

- [x] 4.1 使用已配置 `uat_new` profile 运行临时参数 lifecycle smoke：add、list、update、enable、disable、delete，并确认最终 list 不再返回临时 key。
- [x] 4.2 搜索 `openspec/changes/studio-workspace-parameter-lifecycle` 和相关代码，确认未保存 token、cookie、session id 或临时 smoke key。
- [x] 4.3 运行 `openspec instructions apply --change studio-workspace-parameter-lifecycle --json`，确认 tasks 全部完成。
