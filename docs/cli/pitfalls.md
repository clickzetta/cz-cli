# cli 容易踩的坑

每条按「什么时候会踩 → 结论和条件 → 证据 → 下次怎么做」写。改 `packages/cz-cli` 或 `packages/clickzetta-sdk` 前先读一遍；发现新坑或某条已失效，按[记忆协议](../maintenance/memory-workflow.md)记录。

## 认证与身份

- **判断认证失败**：只认结构化的 `ClickZettaApiError.statusCode === 401`，不要在错误信息里搜 "401"。Job ID 里经常带 401，误判会触发凭据轮换并重复提交 SQL。证据：[#187](https://github.com/clickzetta/cz-cli/pull/187)。
- **token 过期时间**：`expireTimeMs` 是时长（毫秒），不是时间点，绝对过期时间是 `obtainedAt + expireTimeMs`。当成时间点会让 status 显示 1970 年、`expires_in_s` 为 0。新增 token 来源时照 [login-browser.ts](../../packages/cz-cli/src/commands/login-browser.ts) 的写法填。证据：[types/index.ts](../../packages/clickzetta-sdk/src/types/index.ts)。
- **`oauthLoginParam`**：只有显式的 OAuth 登录才附加。混进 PAT 或密码登录，门户会整单返回 5014。证据：[login.ts](../../packages/clickzetta-sdk/src/auth/login.ts)。
- **SDK 认证**：传 `tokens: TokenSource`，不要传 token 字符串（`ClientOptions.token` 已删除），这样 401 时才能轮换。只有字符串时用 `staticTokenSource` 包一层。证据：[client.ts](../../packages/clickzetta-sdk/src/client.ts)。
- **Studio 和 Analytics Agent 的身份**：userId 和 tenantId 从 [context.ts](../../packages/cz-cli/src/connection/context.ts) 的 `identity()` 取，不要在命令里自己拼；401 刷新后整个重建 studio 上下文。以前 401 回退时换错过租户。
- **重新登录**：默认只更新 token，不改 `llm.json`，因为里面的 key 可能是用户自己建的网关 key；只有显式 `--refresh-llm` 才重写。证据：[login.ts](../../packages/cz-cli/src/commands/login.ts)。
- **密码只发给用户配置的主机**：不要发给从 URL 推导出来的 account 主机；回退时校验主机名、要求 console key、拒绝重定向。证据：[#155](https://github.com/clickzetta/cz-cli/pull/155)。

## SQL 与命令参数

- **写操作判断**：不要对 SQL 原文跑正则。先去掉字符串和注释、跳过 CTE，再找括号深度为 0 的关键字；看不懂的 SQL 一律当写操作。新的写动词加进 [readonly.ts](../../packages/clickzetta-sdk/src/sql/readonly.ts) 的 `WRITE` 并补测试。证据：[#194](https://github.com/clickzetta/cz-cli/pull/194)。
- **写操作门挡不住跳过权限的调用方**：对外发布的 [skill](../../skills/cz-cli/SKILL.md) 让外部 Agent 带 `--dangerously-skip-permissions` 调用 cz-cli，这时 `WRITE_NOT_ALLOWED` 不会弹出给人看。要真正挡住 Agent 写操作，得改 skill 或在 cz-cli 侧强制，光改正则不够。见 [Data Agent](data-agent.md#写操作门)。
- **`--limit`**：yargs 会把 `--no-limit` 解析成 0，所以 `--limit 0` 表示不限制；负数和小数报 `USAGE_ERROR`。table 和 schema 命令共用 `parseLimit`。证据：[#193](https://github.com/clickzetta/cz-cli/pull/193)。
- **cron 转换**：转换器表达不了的写法要么拒绝要么等价转换，不能悄悄改语义；但 Studio 里已存的 cron，用户没改就原样写回，不要重新校验后报错。证据：[#192](https://github.com/clickzetta/cz-cli/pull/192)、[#198](https://github.com/clickzetta/cz-cli/pull/198)。
- **日期**：用户输入的日期按本地时区解析（`new Date("YYYY-MM-DD")` 按 UTC），非法日期和越界偏移直接报错。证据：[#188](https://github.com/clickzetta/cz-cli/pull/188)。
