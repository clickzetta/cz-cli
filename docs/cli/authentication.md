# 登录与认证

`auth` 管理登录会话，`profile` 管理实例、工作区和服务等连接上下文。

## 当前行为

- `cz-cli login` 默认使用浏览器 OAuth；`cz-cli auth login <name>` 创建或刷新具名会话。显式凭据及密码登录复用配置流程，PAT 作为连接凭据使用。
- 浏览器流程使用 PKCE S256 和一次性 state，监听本机动态端口。OAuth client 为 `official-cli`，scope 为 `profile offline_access`，身份从 userinfo 获取。
- `--provider` 改走设备码流程（RFC 8628），向 `/clickzetta-hornhub/oauth2/device_authorization` 申请设备码，登录结果与浏览器流程相同，生成的 profile 也一样。支付宝、微信作为 `provider` 参数发送；`password` 作为 `auth_method=password` 发送，`provider=PASSWORD` 会被网关拒绝。设备码流程需要交互式终端。不带 `--provider` 时，本机能打开浏览器（本地桌面）就直接走浏览器登录，不请求 discovery、不弹菜单，第三方登录由浏览器打开的登录页自己提供；本机打不开浏览器（SSH、无显示器）的 TTY 才出现菜单，菜单只列浏览器、微信、支付宝，`password` 只能通过参数指定。`--provider browser` 显式指定浏览器登录，不需要 TTY，供脚本固定行为。浏览器登录在打不开浏览器时不启动浏览器，提示在电脑上打开链接并把跳转后的地址粘回来。
- 支付宝在终端画验证链接的二维码，用支付宝 App 扫码后在 App 内授权。微信的验证页是网站扫码登录页（`snsapi_login`），页面上显示微信自己的二维码，需要在电脑浏览器打开，所以不在终端画二维码，改为打开本机浏览器；`password` 页同样打开浏览器。本机没有可见浏览器时（存在 SSH 会话变量，或在 macOS、Windows 以外的系统上没有 `DISPLAY`/`WAYLAND_DISPLAY`）不尝试打开，只打印链接：微信提示在电脑上打开，`password` 提示任何设备都可以。所有方式都打印验证链接和 `user_code`，不打印 `device_code`。
- 第三方身份绑定多个账号时，先通过网关私有状态接口选定账号，再用标准 token 端点换取令牌；提交选择遇到暂时性错误时重新读取状态，沿用已选账号，不重复提问；身份尚未绑定或注册时网关停在等待态，CLI 继续轮询。截至 2026-11-11，cn、intl、uat-api、dev-api 的 discovery 文档都声明了设备码端点，CLI 运行时以 discovery 为准。
- SDK 的 OAuth token 与 userinfo 请求位于 `/clickzetta-hornhub/oauth2/`。普通 PAT、密码登录默认不附加 `oauthLoginParam`；SDK 只有显式开启 OAuth 升级时才附加。
- `profiles.toml` 的 `[oauth.<name>]` 保存共享令牌，多个 profile 通过 `oauth = "<name>"` 引用。连接实例属于 profile，不属于共享令牌。
- 过期令牌优先使用 refresh token 续期，轮换后保存新令牌；刷新目标使用令牌的 issuer，不能随连接的区域 service 切换。

## 维护约束

- OAuth token store 只绑定 OAuth 身份，不能给普通 PAT、密码登录额外创建 OAuth 会话；缓存按凭据身份隔离。
- 单个 profile 刷新失败不能删除共享会话。当前共享 token store 的 `clear()` 不删除持久令牌；显式 logout 与 profile 删除分别处理其生命周期。
- 纯 OAuth 会话的失效 refresh token 应提示重新登录；暂时的网络或服务故障保留原错误。有 PAT、密码时才存在重新登录的凭据路径。
- 授权码、PKCE verifier、`device_code` 和访问、刷新令牌不得出现在日志或错误正文中。

## 实现与验证入口

- [CLI 登录](../../packages/cz-cli/src/commands/login.ts)、[浏览器 OAuth](../../packages/cz-cli/src/commands/login-browser.ts)、[会话命令](../../packages/cz-cli/src/commands/auth.ts)、[设备码登录](../../packages/cz-cli/src/commands/login-device.ts)、[多账号选择](../../packages/cz-cli/src/commands/device-account-select.ts)。
- [共享存储](../../packages/cz-cli/src/connection/profile-store.ts)、[连接凭据选择](../../packages/cz-cli/src/connection/config.ts)、[SDK 刷新](../../packages/clickzetta-sdk/src/auth/token.ts)。
- [OAuth 常量](../../packages/clickzetta-sdk/src/auth/oauth-constants.ts)、[PKCE 参数测试](../../packages/clickzetta-sdk/test/oauth-login-param.test.ts)、[登录兼容测试](../../packages/clickzetta-sdk/test/login-oauth.test.ts)。
- [共享会话回归](../../packages/cz-cli/test/oauth-section-hygiene.test.ts)、[刷新回归](../../packages/clickzetta-sdk/test/token-refresh.test.ts)、[跨身份隔离](../../packages/clickzetta-sdk/test/token-isolation.test.ts)、[设备码回归](../../packages/cz-cli/test/login-device.test.ts)；网关协议可用 [设备码 demo](../../packages/cz-cli/script/oauth-device-demo.ts) 单独验证。
