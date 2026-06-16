## 1. SDK 支持

- [x] 1.1 在 `packages/clickzetta-sdk/src/studio/task.ts` 增加 `parseTaskDependencyOut` 请求参数类型和函数封装
- [x] 1.2 在 `packages/clickzetta-sdk/src/studio/task.ts` 允许 `saveTaskConfig` 传入 `dataFileOutputListReqs`

## 2. CLI 测试

- [x] 2.1 在 `packages/cz-cli/test/task-lineage.test.ts` 添加 SQL 任务解析成功测试
- [x] 2.2 在 `packages/cz-cli/test/task-lineage.test.ts` 添加集成任务支持和非支持任务类型拒绝测试
- [x] 2.3 在 `packages/cz-cli/test/e2e-help.ts` 添加 `task lineage` 帮助可发现性测试

## 3. CLI 实现

- [x] 3.1 在 `packages/cz-cli/src/commands/task.ts` 引入 SDK 解析函数并新增结果标准化 helper
- [x] 3.2 在 `packages/cz-cli/src/commands/task.ts` 注册 `task lineage <task>` 命令，支持 `--schema`、`--content`、`--file`
- [x] 3.3 在 `packages/cz-cli/src/commands/task.ts` 对非 SQL/集成任务返回 `UNSUPPORTED_TASK_TYPE` 且不调用解析接口
- [x] 3.4 在 `packages/cz-cli/src/commands/task.ts` 为 `save-schedule` 保留 `save-config` 别名以匹配现有测试和旧文档

## 4. 验证

- [x] 4.1 运行新增测试，确认先失败后通过
- [x] 4.2 运行相关 `cz-cli` 测试文件
- [x] 4.3 在 `packages/cz-cli` 运行 `bun typecheck`
- [x] 4.4 运行 `openspec validate add-task-dependency-output-parse-command --strict`
