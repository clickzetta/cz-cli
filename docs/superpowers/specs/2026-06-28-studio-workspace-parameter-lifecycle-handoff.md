# Studio Workspace Parameter Lifecycle 交接

更新时间：2026-06-28 15:00 Asia/Shanghai

## 背景

这次改动来自 `dataworks-spec` 的 ADF -> Lakehouse Studio 迁移需求：ADF factory/global parameters 需要映射到 Studio workspace parameters。由于 `workspace-param` 是 `cz-cli` 自己暴露的 Studio 命令面，已经在本仓库单独落 OpenSpec，不再只记录在 `dataworks-spec` 迁移 change 中。

OpenSpec change：

```text
openspec/changes/studio-workspace-parameter-lifecycle
```

## 已实现范围

- SDK：`packages/clickzetta-sdk/src/studio/workspace-params.ts`
  - `listWorkspaceParams`
  - `addWorkspaceParam`
  - `updateWorkspaceParam`
  - `enableWorkspaceParam`
  - `disableWorkspaceParam`
  - `deleteWorkspaceParam`
- CLI：`packages/cz-cli/src/commands/workspace-param.ts`
  - `cz-cli workspace-param list`
  - `cz-cli workspace-param add`
  - `cz-cli workspace-param update`
  - `cz-cli workspace-param enable`
  - `cz-cli workspace-param disable`
  - `cz-cli workspace-param delete`
- 注册入口：
  - `packages/cz-cli/src/register-commands.ts`
  - `packages/clickzetta-sdk/src/index.ts`
- 测试：
  - `packages/clickzetta-sdk/test/workspace-params.test.ts`
  - `packages/cz-cli/test/e2e-help/core-cases.ts`

## 真实接口契约

- `list` -> `/ide-admin/v1/workspaceParams/list`
  - body: `{ projectId, pageIndex, pageSize }`
- `add` -> `/ide-admin/v1/workspaceParams/add`
  - body: `{ projectId, paramKey, paramValue, sourceType, encrypt }`
- `update` -> `/ide-admin/v1/workspaceParams/update`
  - body: `{ projectId, id, paramKey, paramValue, sourceType, encrypt }`
- `enable` -> `/ide-admin/v1/workspaceParams/publish`
  - body: `{ projectId, id }`
- `disable` -> `/ide-admin/v1/workspaceParams/offline`
  - body: `{ projectId, paramIds: [id] }`
- `delete` -> `/ide-admin/v1/workspaceParams/delete`
  - body: `{ projectId, paramIds: [id] }`

实测注意：`offline` 用 `{ id }` 会失败，服务端返回 `paramIds不能为空`。不要改回单个 `id`。

## 已验证

```shell
cd /Users/zhanglin/IdeaProjects/cz-cli/packages/clickzetta-sdk
bun test test/workspace-params.test.ts
```

结果：6 pass / 0 fail。

```shell
cd /Users/zhanglin/IdeaProjects/cz-cli/packages/cz-cli
bun test ./test/e2e-help.ts
```

结果：97 help cases passed / 0 failed。

```shell
cd /Users/zhanglin/IdeaProjects/cz-cli
openspec validate studio-workspace-parameter-lifecycle --strict
openspec instructions apply --change studio-workspace-parameter-lifecycle --json
```

结果：validate 通过；tasks 15/15 complete，`state=all_done`。

真实 UAT smoke：

- profile：`uat_new`
- 操作链路：`add -> list -> update -> enable -> disable -> delete -> final list`
- 结果：全部成功，最终列表确认临时参数已删除。
- 不要在文件中保存 token、cookie、session id 或临时 smoke key。

## 接手注意

- `workspace-param` 是 Studio workspace parameter 命令，不是 Lakehouse `workspace` 命令的子命令。
- `--project-id` 默认来自 `getStudioContext()` 的当前 workspace project，也允许显式覆盖。
- `update/enable/disable/delete` 都要求正数 `--id`。
- `dataworks-spec` 的迁移 writer 自动 upsert 只应调用 `workspace-param list/add`；生命周期操作必须由用户显式调用。
- 当前 cz-cli 工作区有大量既有 dirty 文件；本次 workspace-param 相关文件以上述列表为准。
