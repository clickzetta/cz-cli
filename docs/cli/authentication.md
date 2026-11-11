# 登录与认证

`auth` 管理登录会话，`profile` 管理实例、工作区和服务等连接上下文。

## 当前行为

- `cz-cli login` 默认使用浏览器 OAuth；`cz-cli auth login <name>` 创建或刷新具名会话。显式凭据及密码登录复用配置流程，PAT 作为连接凭据使用。
- 浏览器流程使用 PKCE S256 和一次性 state，监听本机动态端口。OAuth client 为 `official-cli`，scope 为 `profile offline_access`，身份从 userinfo 获取。
- SDK 的 OAuth token 与 userinfo 请求位于 `/clickzetta-hornhub/oauth2/`。普通 PAT、密码登录默认不附加 `oauthLoginParam`；SDK 只有显式开启 OAuth 升级时才附加。
- `profiles.toml` 的 `[oauth.<name>]` 保存共享令牌，多个 profile 通过 `oauth = "<name>"` 引用。连接实例属于 profile，不属于共享令牌。
- 过期令牌优先使用 refresh token 续期，轮换后保存新令牌；刷新目标使用令牌的 issuer，不能随连接的区域 service 切换。

## 维护约束

- OAuth token store 只绑定 OAuth 身份，不能给普通 PAT、密码登录额外创建 OAuth 会话；缓存按凭据身份隔离。
- 单个 profile 刷新失败不能删除共享会话。当前共享 token store 的 `clear()` 不删除持久令牌；显式 logout 与 profile 删除分别处理其生命周期。
- 纯 OAuth 会话的失效 refresh token 应提示重新登录；暂时的网络或服务故障保留原错误。有 PAT、密码时才存在重新登录的凭据路径。
- 授权码、PKCE verifier 和访问、刷新令牌不得出现在日志或错误正文中。

## 实现与验证入口

- [CLI 登录](../../packages/cz-cli/src/commands/login.ts)、[浏览器 OAuth](../../packages/cz-cli/src/commands/login-browser.ts)、[会话命令](../../packages/cz-cli/src/commands/auth.ts)。
- [共享存储](../../packages/cz-cli/src/connection/profile-store.ts)、[连接凭据选择](../../packages/cz-cli/src/connection/config.ts)、[SDK 刷新](../../packages/clickzetta-sdk/src/auth/token.ts)。
- [OAuth 常量](../../packages/clickzetta-sdk/src/auth/oauth-constants.ts)、[PKCE 参数测试](../../packages/clickzetta-sdk/test/oauth-login-param.test.ts)、[登录兼容测试](../../packages/clickzetta-sdk/test/login-oauth.test.ts)。
- [共享会话回归](../../packages/cz-cli/test/oauth-section-hygiene.test.ts)、[刷新回归](../../packages/clickzetta-sdk/test/token-refresh.test.ts)、[跨身份隔离](../../packages/clickzetta-sdk/test/token-isolation.test.ts)。
