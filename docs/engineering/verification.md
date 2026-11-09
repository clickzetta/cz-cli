# 验证

从受影响的包目录运行检查。遵守[仓库测试规则](../../AGENTS.md#testing)和[类型检查规则](../../AGENTS.md#type-checking)，不从根目录运行测试，不直接运行 `tsc`。

| 范围           | 工作目录                  | 单文件测试示例                                         | 类型检查        |
| -------------- | ------------------------- | ------------------------------------------------------ | --------------- |
| CLI            | `packages/cz-cli`         | `bun test --isolate --timeout 30000 test/jdbc.test.ts` | `bun typecheck` |
| ClickZetta SDK | `packages/clickzetta-sdk` | `bun test test/cancel.test.ts`                         | `bun typecheck` |

完整入口见 [CLI scripts](../../packages/cz-cli/package.json)、[SDK scripts](../../packages/clickzetta-sdk/package.json)、[core scripts](../../packages/core/package.json)和 [opencode scripts](../../packages/opencode/package.json)。按改动影响选择检查；集成测试的环境和凭据要求应先从对应测试入口核对。

维护工具在 `packages/cz-cli` 中用 `bun test --isolate --timeout 30000 test/maintenance-state.test.ts test/maintenance-reply.test.ts test/maintenance-cli.test.ts` 验证，用 `bun typecheck --project tsconfig.tools.json` 检查脚本与测试类型；发送测试不向真实群投递消息。

- 行为修复采用能捕捉原错误的回归验证；适用时确认旧行为失败、修复后通过。文档和保持行为的改动使用相称的检查。
- 保存源码版本、工作目录、命令、退出码和日志。失败记录保留，修复后补充新的验证；未运行与跳过的检查明确列出。
- 实际平台行为与构建结果分别记录，跨平台编译不代表目标平台已通过运行验证。
