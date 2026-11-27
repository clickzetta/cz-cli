# cli 容易踩的坑

每条按「什么时候会踩 → 结论和条件 → 证据 → 下次怎么做」写。改 `packages/cz-cli` 或 `packages/clickzetta-sdk` 前先读一遍；发现新坑或某条已失效，附上具体 Issue/PR 或源码证据直接更新本文件。

## 认证与身份

- **私有化部署认证入口与多步认证**：核对实际部署的认证端点与完整响应，公有云域名惯例不一定适用；立即返回 token 的单测覆盖不到多步认证。MFA 或二次挑战表示认证尚未完成，不能当作密码错误或登录成功，也绝不能为跑通测试而关闭校验。参考 [authentication.md](authentication.md) 与 [account-login.ts](../../packages/cz-cli/src/commands/account-login.ts)。

- **判断认证失败**：只认结构化的 `ClickZettaApiError.statusCode === 401`，不要在错误信息里搜 "401"。Job ID 里经常带 401，误判会触发凭据轮换并重复提交 SQL。证据：[#187](https://github.com/clickzetta/cz-cli/pull/187)。
- **token 过期时间**：`expireTimeMs` 是时长（毫秒），不是时间点，绝对过期时间是 `obtainedAt + expireTimeMs`。当成时间点会让 status 显示 1970 年、`expires_in_s` 为 0。新增 token 来源时照 [login-browser.ts](../../packages/cz-cli/src/commands/login-browser.ts) 的写法填。证据：[types/index.ts](../../packages/clickzetta-sdk/src/types/index.ts)。
- **`oauthLoginParam`**：只有显式的 OAuth 登录才附加。混进 PAT 或密码登录，门户会整单返回 5014。证据：[login.ts](../../packages/clickzetta-sdk/src/auth/login.ts)。
- **SDK 认证**：传 `tokens: TokenSource`，不要传 token 字符串（`ClientOptions.token` 已删除），这样 401 时才能轮换。只有字符串时用 `staticTokenSource` 包一层。证据：[client.ts](../../packages/clickzetta-sdk/src/client.ts)。
- **Studio 和 Analytics Agent 的身份**：userId 和 tenantId 从 [context.ts](../../packages/cz-cli/src/connection/context.ts) 的 `identity()` 取，不要在命令里自己拼；401 刷新后整个重建 studio 上下文。以前 401 回退时换错过租户。
- **重新登录**：默认只更新 token，不改 `llm.json`，因为里面的 key 可能是用户自己建的网关 key；只有显式 `--refresh-llm` 才重写。证据：[login.ts](../../packages/cz-cli/src/commands/login.ts)。
- **密码只发给用户配置的主机**：不要发给从 URL 推导出来的 account 主机；回退时校验主机名、要求 console key、拒绝重定向。证据：[#155](https://github.com/clickzetta/cz-cli/pull/155)。

- **Secret-file/stdin inputs still need output checks**: keeping credentials out of argv does not protect logs or errors. On 2026-11-18, actual-command probes of PR #217 head `e94b9e90` reproduced credential disclosure through SDK debug request bodies and raw malformed-JSON errors despite passing focused tests/typechecks (private review/probe evidence; [public review context](https://github.com/clickzetta/cz-cli/pull/217#issuecomment-6975356814)). Next time trace command, context and SDK logging and check sanitized stdout/stderr through the actual command for debug and malformed input. This historical finding does not assess replacement heads; verify each new head.

- **Check multipart filenames on the wire**: on Bun 1.3.14, PR #217 head `ebf56b0` passed a mocked `File.name` basename assertion while real HTTP serialization sent the original absolute path ([2026-11-18 review](https://github.com/clickzetta/cz-cli/pull/217#issuecomment-6976120972); private raw multipart evidence). For upload privacy, inspect received `Content-Disposition` and file bytes through local HTTP. At replacement `384e6426`, copying file bytes passed that check and restoring the old wrapper failed it (private regression evidence). Recheck the actual transport after runtime or upload changes; this historical finding does not establish behavior at later heads.

## SQL 与命令参数

- **写操作判断**：不要对 SQL 原文跑正则。先去掉字符串和注释、跳过 CTE，再找括号深度为 0 的关键字；看不懂的 SQL 一律当写操作。新的写动词加进 [readonly.ts](../../packages/clickzetta-sdk/src/sql/readonly.ts) 的 `WRITE` 并补测试。证据：[#194](https://github.com/clickzetta/cz-cli/pull/194)。
- **写操作门挡不住跳过权限的调用方**：外部 Agent（通过 [MCP 或客户端集成](skills.md) 接入时）若被配置为自动放行工具调用或直接附带 `--write` 执行 cz-cli，这时 `WRITE_NOT_ALLOWED` 不会停下来等人确认。要真正挡住外部 Agent 写操作，得在调用端权限配置或 cz-cli 侧强制限制，光改 SQL 只读判断不够。见 [Data Agent](data-agent.md#写操作门)。
- **`--limit`**：yargs 会把 `--no-limit` 解析成 0，所以 `--limit 0` 表示不限制；负数和小数报 `USAGE_ERROR`。table 和 schema 命令共用 `parseLimit`。证据：[#193](https://github.com/clickzetta/cz-cli/pull/193)。
- **cron 转换**：转换器表达不了的写法要么拒绝要么等价转换，不能悄悄改语义；但 Studio 里已存的 cron，用户没改就原样写回，不要重新校验后报错。证据：[#192](https://github.com/clickzetta/cz-cli/pull/192)、[#198](https://github.com/clickzetta/cz-cli/pull/198)。
- **日期**：用户输入的日期按本地时区解析（`new Date("YYYY-MM-DD")` 按 UTC），非法日期和越界偏移直接报错。证据：[#188](https://github.com/clickzetta/cz-cli/pull/188)。

- **Check scheduling fields from save through publish status.** In PR #227 on 2026-11-24, `97d5355` reset a saved activation mode during node and cron saves, and `05f89f7` hid a mode-only change from publish status. When adding a writable scheduling field, read the saved value from its owning configuration endpoint and test that sibling saves preserve it, including paths that rebuild cron fields. Check content and deployed schedule readback, and run an actual-command test where only that field changes. For `scheduleCreatedType`, compare equivalent numeric and string values equally and keep missing values distinct from explicit modes. [Node configuration](https://github.com/clickzetta/cz-cli/pull/227#discussion_r4677037388), [cron saves](https://github.com/clickzetta/cz-cli/pull/227#discussion_r4677037397), [publish status](https://github.com/clickzetta/cz-cli/pull/227#discussion_r4677086887)

- **Check option arity alongside positionals.** On 2026-11-24, the variadic yargs array for `--schedule-created-type` consumed the following task or name on four commands. The fix declares a scalar and preserves its repeated occurrences for rejection, while ordinary repeated scalars still use the last value and array options still collect values. For a single-value option that rejects repeats, check out the exact commit under review and run its actual CLI with the flag before and after the positional, using both space and equals forms, and verify the intended target and value reach the save request. Assert zero HTTP requests for invalid, empty, or missing values and for identical, distinct, or bare repeats. [Issue #228](https://github.com/clickzetta/cz-cli/issues/228), [PR #230](https://github.com/clickzetta/cz-cli/pull/230)

- **Parser declarations and coercion do not validate original values**: PR #220 at `df64e4b6` forwarded page `0`, `-1` and `1.5`, while `Infinity` became JSON `null` ([2026-11-18 review](https://github.com/clickzetta/cz-cli/pull/220#issuecomment-6977397374)). PR #221 at `cd06a5e0` accepted array-valued statuses through `String(status)` and reported zero rejections; bare `--join` sent an empty batch despite required-option checks ([2026-11-19 review](https://github.com/clickzetta/cz-cli/pull/221#issuecomment-6998904261)). Exercise actual parser/HTTP boundaries: require positive safe-integer page indices before context/network, nonempty batches, and recognized original string statuses. Keep command-specific exceptions such as `--limit 0`. Recheck replacement heads; synthetic responses establish client handling, while backend response/count/normalization semantics require authoritative evidence.
