# Analytics Agent

`cz-cli analytics-agent` 封装分析域、数据源、知识、指标和问答会话等远端 API。这里的分析会话与维护 loop、CLI 内置 Agent 会话各自独立。

## 连接与参数

- endpoint 依次取当前 profile 的 `analysis_agent_endpoint`、兼容字段 `agent.endpoint`，最后从规范化的 `service` 和 `protocol` 追加 `/clickzetta-campaign-data` 推导。
- 请求体需要多域绑定的命令使用 `--domain-ids '[5,6]'`，转为正整数数组 `domainIds`；路径、查询中的单域参数继续使用 `domainId`。
- 数字 ID 在发请求前校验为正整数；`parent-id` 允许 `0`，字符串任务标识 `task-id` 不套用数字规则。
- knowledge 文件夹排序使用 `--nodeIds` JSON 数组；改名、移动、复制等命令使用各自的显式参数，具体参数以子命令帮助为准。

## 表名解析

- `metric create`、`validate`、`update` 和带 `--table-name` 的 `list` 从已登记数据集的 `tableName`、`physicalTable` 解析名称。短名使用当前 profile 或显式 `--workspace`、`--schema`；`--datasource-id` 限制数据源。完整登记路径优先精确匹配。
- 只有唯一匹配才提交真实 `tableName` 和对应数据源；多个候选返回 `AMBIGUOUS_DATASET` 并列出完整路径、数据源及数据集 ID。当前范围找不到但有其他范围同名候选时返回 `DATASET_NOT_FOUND` 和 `Did you mean` 提示。权限失败或分页不完整不能当作无匹配继续执行。
- 不通过字符串拼接猜测 `v_gpt_`：共享 schema 可直接使用源表，系统视图可位于不同 workspace。SQL 表达式与关联定义不自动改写。
- 指标表名更新未指定数据源时沿用原指标的数据源与分析域；不含表名的补丁不读取数据集。创建、校验和按表过滤的列表在唯一匹配时采用该数据集的数据源。
- `dataset` 为 `table` 别名；新增 `list`、`detail`，详情支持 `--dataset-id` 或 `--table-name`。`update` 支持二者择一，仍必须显式传 `--domain-id` 并校验所属域。原有按 ID 操作保持兼容。
- 验证入口为 [表名解析回归](../../packages/cz-cli/test/analytics-agent-table-resolution.test.ts)，通过本地 HTTP 服务检查真实 CLI 请求和写入前的歧义拦截。

## 问答会话

- 同一 session 的问答由调用方串行提交，前一个问题完成后再发下一个。命令帮助和结果提示该后端约束，不能把提示当成客户端并发锁。
- `session delete --session-id <id>` 将显式 ID 写入请求体 `sessionId`；缺失或非法值在本地拒绝。
- `session create` 的非空标题先取 `--title` 或 `--body.title`，再取问题文本，最后使用 `Analytics Agent Session`。
- `session run` 未传 `--session-id` 时可按 `--domain-id` 自动建会话，标题取 `--body` 中的非空 `title` 或问题文本；没有可用标题时在建会话前拒绝请求。

## Reading historical session questions

`session questions --session-id <id>` reads all historical questions through
`POST /open/session/open`, using the selected profile's authenticated identity.
No domain ID or individual question IDs are required. Questions retain the
backend order, newest first. By default each row includes `questionId`,
`questionText`, and `createTime`; `--include-answers` retains complete question
records, including answer responses, SQL, charts, and historical error events.

```bash
cz-cli analytics-agent session questions --session-id 1354 --format table
cz-cli analytics-agent session questions --session-id 1354 --include-answers
```

JSON output includes session metadata, `questions`, and the returned question
count. Table, CSV, text, and JSONL output project questions as rows. The full
session endpoint avoids incomplete history from the current paged endpoint's
unpopulated `hasMore`; large histories can produce large responses. The CLI
computes `totalCount` from the complete returned list instead of trusting the
full endpoint's default zero value.

An existing empty session succeeds with `questions: []`; a deleted session
reports `SESSION_DELETED`. Missing session data reports
`SESSION_NOT_FOUND_OR_FORBIDDEN`, because the backend does not distinguish a
missing session from another user's inaccessible private session. Explicit
backend permission failures retain their error code and message. Historical
answer error events remain readable history and do not fail the listing.

Regression coverage: [session question history tests](../../packages/cz-cli/test/analytics-agent-session-questions.test.ts).

## 实现与验证入口

- [命令、参数校验和请求执行](../../packages/cz-cli/src/commands/analytics-agent.ts)、[endpoint 选择](../../packages/cz-cli/src/connection/profile-store.ts)。
- [endpoint 回归](../../packages/cz-cli/test/profile-store.test.ts)、[数字 ID 回归](../../packages/cz-cli/test/analytics-agent-id-validation.test.ts)、[多域绑定回归](../../packages/cz-cli/test/analytics-agent-knowledge-domain-id.test.ts)。
- [会话参数与提示回归](../../packages/cz-cli/test/analytics-agent-session-commands.test.ts)、[实际请求边界回归](../../packages/cz-cli/test/analytics-agent-session-run.test.ts)。

## Applying domain joins

Repeat `--join` once per relation string to send all relations in one `joins` array.
Read each dataset ID and canonical table name from `domain detail <domainId>
--with-tables`; never infer names or add a view prefix. Values use
`ID:TABLE.COLUMN=JOIN_ID:JOIN_TABLE.COLUMN@RELATION`, not JSON objects or arrays.
Each occurrence requires one nonempty value, and the batch must contain at least
one relation. Every value is parsed before any request; an invalid value reports
its one-based `--join item N` position and stops the batch. Missing values are
rejected by the CLI parser before HTTP.

The following are CLI parsing expectations, not a verified backend contract.
When `results` is present, the CLI expects exactly one result per input with a
unique zero-based `index` and a string `status` of `applied`, `already_exists`, or
`rejected`. It retains the original results and adds `requestedCount`,
`appliedCount`, `alreadyExistsCount`, and `rejectedCount`. If `submittedCount` is
present, the CLI expects it to equal the number of `applied` results. For example,
a fixture with four `already_exists` results and `submittedCount: 0` yields
`requestedCount: 4` and `alreadyExistsCount: 4`.

Any recognized rejected item produces exit code 1 and `JOIN_APPLY_REJECTED`,
with counts and original per-item reasons under `data`. The CLI sends no rollback
request. Incomplete, duplicate, out-of-range, unknown-status or non-string-status
results, or an inconsistent `submittedCount`, produce
`JOIN_APPLY_RESULT_MISMATCH`; read back the saved joins before retrying. Responses
without `results` retain exit code 0 but report `status: "unverified"`, without
inventing applied counts.

Verify using `domain joins list --domain-id <id>`. Backend result semantics and
normalization have not been established by an authoritative contract or captured
backend response. Regression coverage verifies these CLI expectations against
synthetic responses through the real parser and local HTTP transport in
[batch apply tests](../../packages/cz-cli/test/analytics-agent-joins-batch.test.ts).
