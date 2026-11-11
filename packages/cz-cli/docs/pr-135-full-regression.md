# PR #135 全量回归记录

日期：2026-11-10

PR：https://github.com/clickzetta/cz-cli/pull/135

测试提交：`bec7bf6b1`（分支 `resource-api-updates`）。对照提交：PR merge-base `80308a7f3e`。

## 结论

未发现本次接口适配及后续修复引入的新回归。此前反馈的 `--domain-ids` 错误消息断言、Answer Builder DSL 校验、空白别名误清空、Analytics Agent 测试状态泄漏均通过回归。

**全量测试没有全部通过**：cz-cli 1835 项测试中，1768 通过、65 跳过、2 项 SQL 监督进程相关测试超时。对照版本的同一 SQL 测试文件也出现超时，且部分用例单独运行时通过，说明这一组测试存在既有的不稳定性。不能据此声称远端 CI 已通过，也不能将本次 2 项超时全部逐项归因为同一个已确定的根因。

## 执行范围与结果

按照 `.github/workflows/cz-test.yml` 执行全部检查，另补充命令帮助、路由及共享进程回归。命令均从对应包目录执行，没有从仓库根目录运行测试。

| 包目录 | 命令 | 结果 | 日志 |
| --- | --- | --- | --- |
| packages/cz-cli | `bun typecheck` | 通过 | `cz-full-audit-typecheck.log` |
| packages/cz-cli | `bun run test` | 1768 pass / 65 skip / 2 fail，134 文件，523.44 秒 | `cz-full-audit-tests.log` |
| packages/npm/cz-cli | `node --test test/*.test.mjs` | 14 pass / 0 fail | `cz-full-audit-installer.log` |
| packages/core | `bun test test/model-selection.test.ts` | 7 pass / 0 fail | `cz-full-audit-core.log` |
| packages/opencode | `bun test test/provider/clickzetta-discovery.test.ts test/provider/clickzetta-context-limit.test.ts` | 18 pass / 0 fail | `cz-full-audit-provider.log` |
| packages/cz-cli | `bun test/e2e-help.ts` | 142 pass / 0 fail | `cz-full-audit-help.log` |
| packages/cz-cli | `bun test/e2e-routing.ts` | 23 pass / 0 fail | `cz-full-audit-routing.log` |
| packages/cz-cli | `bun run test test/analytics-agent` | 隔离模式：210 pass / 0 fail | `cz-full-audit-analytics-shared.log` |
| packages/cz-cli | `bun test test/analytics-agent` | 共享进程：210 pass / 0 fail | `cz-full-audit-analytics-shared-process.log` |

补充运行的 Analytics Agent 用例与全量测试重叠，不应加总为独立覆盖数量。测试环境为本机 macOS、Bun 1.4.0；未在本机模拟 Linux CI runner。

65 项跳过涉及需要集成环境的 task、datasource、runs 等测试。跳过不代表通过。本轮没有强制启用这些测试，也没有重新执行依赖真实后端并创建业务资源的完整端到端脚本。这里的“全量”范围是 cz-test 工作流的全部检查及上述补充检查，不是上游所有包的全部测试。

## 失败项与基线对照

全量运行中的两项失败均在 `packages/cz-cli/test/sql-cleanup-scope.test.ts`：

1. `bundled cz bootstrap passes supervision to children through inherited environment`：15000ms 超时。
2. `unmodified upstream process runner inherits supervision and cancels after timeout`：30000ms 超时。

进一步对照：

| 版本 / 运行方式 | 结果 | 日志 |
| --- | --- | --- |
| 当前提交，运行整个 SQL 文件 | 14 pass / 1 fail；bootstrap 超时，upstream runner 通过 | `cz-full-audit-head-sql-suite.log` |
| 改动前基线，运行整个 SQL 文件 | 12 pass / 3 fail；submit、healthy heartbeats、bootstrap 超时；upstream runner 通过 | `cz-full-audit-base-sql-suite.log` |
| 当前提交，仅运行 bootstrap | 1 pass | `cz-full-audit-head-sql.log` |
| 改动前基线，仅运行 bootstrap | 1 pass | `cz-full-audit-base-sql.log` |

bootstrap 的超时在基线中直接复现。upstream runner 在全量中超时、在 SQL 文件回归中通过，尚未确定其全量超时的具体原因。部分对照任务曾并行运行，因此不将这些运行时间用于性能比较。

已用 `git diff --exit-code 80308a7f3e HEAD -- packages/cz-cli/src/sql packages/cz-cli/src/commands/exec.ts packages/cz-cli/test/sql-cleanup-scope.test.ts` 确认上述 SQL 实现和测试在 PR 前后没有差异。没有通过调大超时、删除用例或修改断言掩盖失败。

## 改动影响检查

本 PR 唯一修改的生产代码文件为 `packages/cz-cli/src/commands/analytics-agent.ts`。其余为 README 和相关测试。

- 指标定义更新与域绑定更新分开；部分更新只发送提供的字段。
- 数据源、分析域、Answer Builder 的字段校验、空数组、显式 null、状态回退及请求内容已有回归覆盖。
- Answer Builder 从 body/body-file 传入 content 时必须为字符串，并进行 DSL/outputColumns 校验；对象、数组、数字、布尔及 null 均在 HTTP 请求前拒绝。
- 指标别名仅显式空数组触发清空；空白字符串数组不再隐式清空。
- 非法混合 `--domain-ids '[7,"seven"]'` 返回 USAGE_ERROR，错误消息包含 `--domain-ids`。
- Analytics Agent 210 项在共享进程与隔离模式均通过，未复现先前 tenantId 状态泄漏失败。
- `git diff --check 80308a7f3e...HEAD` 通过。

本轮未修改产品代码；仅补充本回归记录作为文档提交。PR 链接保持不变。表中的日志文件名对应本机测试产物，未提交到仓库。全量日志保留于 `/private/tmp/cz-full-audit-*.log`；该位置为临时目录，长期归档应另行保存。
