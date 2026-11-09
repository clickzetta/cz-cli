# SQL

SQL 维护同时检查 CLI 命令与 SDK 执行链，关注提交、轮询、取消、超时及退出后的资源清理。

- [取消与生命周期设计](../../specs/sql-cancellation.md)：取消语义、实现路径和验收范围。
- [SQL 命令](../../packages/cz-cli/src/commands/sql.ts)。
- [CLI 生命周期](../../packages/cz-cli/src/commands/sql-lifecycle.ts)。
- [SDK 提交](../../packages/clickzetta-sdk/src/sql/submit.ts)、[轮询](../../packages/clickzetta-sdk/src/sql/poll.ts)、[取消](../../packages/clickzetta-sdk/src/sql/cancel.ts)。
- [CLI 回归验证](../../packages/cz-cli/test/sql-cancellation.test.ts)、[SDK 取消验证](../../packages/clickzetta-sdk/test/cancel.test.ts)。

## 写入审批

`cz-cli sql` 在执行前做字符串级检查，只用于防止误写，不能证明 SQL 无副作用。需要用户批准后加 `--write` 的情况：

- 识别出的写入语句，返回 `WRITE_NOT_ALLOWED`。
- 改变服务端词法的设置：`cz.sql.string.literal.escape.mode`、`cz.sql.translation.mode`、`cz.sql.double.quoted.identifiers`，来自 `--set` 或脚本中的 `SET`；以及无法归一为普通点分键的 `SET` 目标。
- 本地扫描无法跟踪的记号：`$$` 引号、`#`、游离的 `\` 或 `*/`、独立的 `r'…'`/`e'…'` 前缀字符串。

后两类返回 `SQL_READONLY_UNKNOWN`，且 `--dry-run` 直接拒绝。普通查询、优化器 hint（`/*+ … */`）、其他查询设置和无法分类的 SQL 不再因无法识别而要求 `--write`。`--write` 不绕过无 `WHERE` 的 `DELETE`/`UPDATE` 拦截。`--dry-run` 只接受识别为只读的查询。

来源：[检查与审批](../../packages/cz-cli/src/commands/sql.ts) 中的 `validateSqlInput`、[SDK 分类](../../packages/clickzetta-sdk/src/sql/readonly.ts)、[扫描](../../packages/clickzetta-sdk/src/sql/scan.ts)、[CLI 验证](../../packages/cz-cli/test/sql-readonly.test.ts)，引入于 PR #126。

验证命令与证据要求见[开发与验证](../engineering/verification.md)。
