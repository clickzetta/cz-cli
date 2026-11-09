# Analytics Agent

`cz-cli analytics-agent` 封装分析域、数据源、知识、指标和问答会话等远端 API。这里的分析会话与维护 loop、CLI 内置 Agent 会话各自独立。

## 连接与参数

- endpoint 依次取当前 profile 的 `analysis_agent_endpoint`、兼容字段 `agent.endpoint`，最后从规范化的 `service` 和 `protocol` 追加 `/clickzetta-campaign-data` 推导。
- 请求体需要多域绑定的命令使用 `--domain-ids '[5,6]'`，转为正整数数组 `domainIds`；路径、查询中的单域参数继续使用 `domainId`。
- 数字 ID 在发请求前校验为正整数；`parent-id` 允许 `0`，字符串任务标识 `task-id` 不套用数字规则。
- knowledge 文件夹排序使用 `--nodeIds` JSON 数组；改名、移动、复制等命令使用各自的显式参数，具体参数以子命令帮助为准。

## 问答会话

- 同一 session 的问答由调用方串行提交，前一个问题完成后再发下一个。命令帮助和结果提示该后端约束，不能把提示当成客户端并发锁。
- `session delete --session-id <id>` 将显式 ID 写入请求体 `sessionId`；缺失或非法值在本地拒绝。
- `session create` 的非空标题先取 `--title` 或 `--body.title`，再取问题文本，最后使用 `Analytics Agent Session`。
- `session run` 未传 `--session-id` 时可按 `--domain-id` 自动建会话，标题取 `--body` 中的非空 `title` 或问题文本；没有可用标题时在建会话前拒绝请求。

## 实现与验证入口

- [命令、参数校验和请求执行](../../packages/cz-cli/src/commands/analytics-agent.ts)、[endpoint 选择](../../packages/cz-cli/src/connection/profile-store.ts)。
- [endpoint 回归](../../packages/cz-cli/test/profile-store.test.ts)、[数字 ID 回归](../../packages/cz-cli/test/analytics-agent-id-validation.test.ts)、[多域绑定回归](../../packages/cz-cli/test/analytics-agent-knowledge-domain-id.test.ts)。
- [会话参数与提示回归](../../packages/cz-cli/test/analytics-agent-session-commands.test.ts)、[实际请求边界回归](../../packages/cz-cli/test/analytics-agent-session-run.test.ts)。
