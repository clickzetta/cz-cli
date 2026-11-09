# SQL

SQL 维护同时检查 CLI 命令与 SDK 执行链，关注提交、轮询、取消、超时及退出后的资源清理。

- [取消与生命周期设计](../../specs/sql-cancellation.md)：取消语义、实现路径和验收范围。
- [SQL 命令](../../packages/cz-cli/src/commands/sql.ts)。
- [CLI 生命周期](../../packages/cz-cli/src/commands/sql-lifecycle.ts)。
- [SDK 提交](../../packages/clickzetta-sdk/src/sql/submit.ts)、[轮询](../../packages/clickzetta-sdk/src/sql/poll.ts)、[取消](../../packages/clickzetta-sdk/src/sql/cancel.ts)。
- [CLI 回归验证](../../packages/cz-cli/test/sql-cancellation.test.ts)、[SDK 取消验证](../../packages/clickzetta-sdk/test/cancel.test.ts)。

验证命令与证据要求见[开发与验证](../engineering/verification.md)。
