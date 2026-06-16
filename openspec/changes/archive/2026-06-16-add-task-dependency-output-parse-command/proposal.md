## Why

Studio SQL 任务和集成任务在保存调度配置前，需要先解析任务产出表和调度依赖。当前 CLI 只能手工维护依赖，不能复用 Studio 的解析接口，也不能明确给出保存调度配置所需的依赖、产出字段。

## What Changes

- 新增 `cz-cli task lineage <task>` 命令，调用 Studio `parseDataFileDependencyOut` 接口解析任务产出和调度依赖。
- 命令仅支持 SQL 任务和集成任务；其他任务类型返回明确的不支持错误。
- 解析结果保留 Studio 返回的原始依赖和产出信息，并输出面向用户确认的调度依赖、任务产出字段。
- `task save-cron`、`task save-schedule/save-config` 保存 SQL/集成任务调度配置时自动调用解析接口，把解析出的依赖和产出随调度配置一起保存。
- 保存调度配置时解析并保存执行集群 ID，包括 `DEFAULT` 集群。

## Capabilities

### New Capabilities
- `task-dependency-output-parse`: Studio 任务依赖和产出解析命令，覆盖支持类型、解析入参、保存配置字段和错误场景。

### Modified Capabilities
- `cli-command-routing`: 新增 `task lineage` 子命令应被 CLI 路由识别，并出现在 `task --help` 中。

## Impact

- `packages/cz-cli/src/commands/task.ts`: 新增命令处理、任务类型校验、解析输出标准化。
- `packages/clickzetta-sdk/src/studio/task.ts`: 新增解析接口封装，并支持保存产出列表。
- `packages/cz-cli/test/*.test.ts`: 增加命令行为、保存自动解析和帮助信息测试。
- Studio API: `/ide-admin/v1/dataFileConfiguration/parseDataFileDependencyOut`。
