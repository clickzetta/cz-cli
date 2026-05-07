# 单点登录 （Private Preview）

本文档旨在帮助您逐步完成单点登录配置，确保能顺利使用 OAuth 2.0/OIDC 或 SAML 2.0 协议启用 SSO 功能。

***

## 基础概念简介

* **单点登录**（**SSO**）：用户通过一次身份验证即可访问多个系统，简化登录流程并提高安全性。

* **联合身份验证（Federated Authentication）**：Lakehouse（服务提供方，SP）信任外部身份提供方（IdP）执行用户认证。

* **协议简述**：

  * **SAML 2.0**：基于 XML 的身份断言协议，通过 Assertion 传递用户身份信息。
  * **OAuth 2.0 / OpenID Connect（OIDC）**：OAuth 提供授权机制，OIDC 增加身份层，使用 JWT 格式的 ID Token 表达用户身份。

## ClickZetta 与客户 IdP 的关系

* 在 IdP 中注册 Lakehouse 应用（提供回调地址/ACS、Entity ID、签名或加密证书）
* 在 Lakehouse 平台中填写 IdP 提供的参数
* 配置完成后支持两种登录流程：用户从 Lakehouse 登录（SP-init）或从 IdP 登录（如果支持 IdP-init）

## 功能局限

当前 Lakehouse **不支持**以下功能，请在配置与使用时注意：

1. **不支持全局登出**。用户在 IdP 的登出操作不影响在 Lakehouse 的登录状态。用户需要在 Lakehouse 中单独登出。
2. **不支持配置多个 IdP**。仅支持一个 IdP 连接。
3. **单点登录仅支持 Web 端登录**。当前不支持通过 JDBC、Python SDK、Java SDK 等使用 SSO 登录。
4. **身份映射字段局限**：SAML 2.0 协议仅支持使用 Email 作为用户身份映射字段；OAuth 2.0 / OpenID Connect (OIDC) 协议仅支持使用 Email 或 Phone 作为用户身份映射字段。
5. **身份映射字段唯一性要求**：当某字段被用作身份映射字段时，在 Lakehouse 中所有用户的该字段信息须保持唯一。如果 Lakehouse 中多个用户的邮箱或手机号信息存在重复，且该字段被用于单点登录的身份映射字段，则信息重复的用户将不能正常登录。

***

## 协议配置指南

### 开启单点登录

Lakehouse账户中，SSO登录（单点登录）默认关闭。拥有账户管理员身份的用户可以操作开启。

登录 Lakehouse 账户，进入“账户中心”页面，在 SSO 登录选项中，点击“开启 SSO 登录”。

![](.topwrite/assets/screenshot-20250814-145644.png)

**注意**：开启 SSO 登录后，该账户下所有用户只能使用 SSO 方式登录，不再允许使用用户名/密码方式进行 Web 登录。因此在开启单点登录前，请确保账户下所有需要登录 Lakehouse 的用户：

1）在Idp中拥有用户身份；

2）在Lakehouse中用于身份映射的信息（邮箱或电话号码）唯一，不与其他用户重复。

### OAuth 2.0 / OpenID Connect (OIDC) 协议

**1. 选择协议**

开启 SSO 登录后，在右侧弹窗中选择 “OAuth 2.0 / OIDC 协议”。选择协议后，您可在协议下方看到该协议的回调地址，如：

:-: ![](.topwrite/assets/image_1755158785697.png =575)

```SQL
https://api.clickzetta.com/clickzetta-portal/sso/oidc/consume?u={code}
```

^

请使用该回调地址，在您的 IdP 服务中注册 Lakehouse 应用，并记录注册后的 Client ID 和其他配置值，以便在后续配置中使用。

**配置授权端点（Authorization Endpoint）**

:-: ![](.topwrite/assets/image_1755160968700.png =525)

**参数**：

* 授权端点URL（例如 `https://idp.example.com/authorize`）：用于重定向用户到 IdP 进行身份授权
* Client ID：标识 Lakehouse 在 IdP 上的应用，您可在您的 IdP 服务中完成对 Lakehouse 应用的注册后获得。
* 响应类型（response\_type）：仅支持Code模式。
* Scope（如 `openid`, `profile`, `email`）：决定可以请求的用户信息，支持多选。当使用 OpenID Connect 协议时，必须勾选 openid 选项。支持勾选“其他”后填写自定义的 scope 参数。
* 可选扩展参数：便于根据 IdP 要求添加额外字段（如 `prompt=login`）。

**配置令牌端点（Token Endpoint）**

:-: ![](.topwrite/assets/image_1755161141507.png =510)

**参数**：

* 令牌端点URL：用于交换授权码获取令牌。通常在Lakehouse调用Idp的授权端点后，会获取访问Code。Lakehouse 会继续调用令牌端点 URL 来使用 Code 交换令牌。
* Client Secret（非必须）：用于验证客户端身份。如 IdP 系统注册应用未颁发则此项可为空。
* 可选扩展参数：根据 IdP 要求添加。

^

**配置用户信息端点（UserInfo Endpoint）**

:-: ![](.topwrite/assets/image_1755161329682.png =530)

**参数**：

* 用户信息端点URL：用于Lakehouse调用并获取用户详细信息。
* 身份映射配置：
* userinfo 字段：指 Lakehouse 从 UserInfo Endpoint 获取的身份信息字段。可选 Email、Phone 或自定义字段。
* 身份映射字段：指能够与 UserInfo 指定字段匹配的身份信息字段，可选 Email 或 Phone。注意：如果身份映射字段选择 Phone（手机号），Lakehouse 能够识别国家码为 00、+ 或不填写国家码的三种手机号格式。
* 测试用户信息完整度：根据所选的“身份映射字段”，检查并列出当前账户下所有用户中缺失该信息或该信息重复的用户。这些用户在开启SSO后，不能正常登录。
* 可选扩展参数：根据 IdP 要求添加。

**账户管理员可同时使用云器账号登录**

开启该选项，则允许具备账户管理员角色的用户继续使用用户名和密码登录，以便当SSO登录出现故障时，仍能够登录并修改账户配置。

^

### SAML 2.0 协议

**选择协议**

开启 SSO 登录后，在右侧弹窗中选择 “SAML 2.0 协议”。选择协议后，您可在协议下方看到该协议的回调地址（Assertion Consumer Service URL），如：

:-: ![](.topwrite/assets/image_1755161484299.png =616)

```SQL
https://api.clickzetta.com/clickzetta-portal/sso/saml/consume?u={code}
```

请使用该地址，在 IdP 中注册应用，并记录及保存 IdP 所返回的 Entity ID 和 X.509 证书。

^

**填写 SSO 登录 URL**

:-: ![](.topwrite/assets/image_1755161389065.png =457)

**参数**：

* SSO Login URL：IdP 接收 SAML Request 的端点。
* Entity ID：IdP 中对应用的身份标识，在 IdP 内完成应用注册后可以获得。
* X.509 证书（非必须）：用于校验签名、保证数据安全，在 IdP 内完成应用注册后可以获得。
* Issuer（非必须）：发出 SAML 断言的实体，用于进行信任验证。
* 测试用户信息完整度：SAML2.0协议目前仅支持以邮箱地址作为用户身份映射字段。用户信息完整度测试会检查并列出当前账户内所有用户中缺失邮箱信息或邮箱信息重复的用户。这些用户在开启SSO后，不能正常登录。

**账户管理员可同时使用云器账号登录**

开启该选项，则允许具备账户管理员角色的用户继续使用用户名和密码登录，以便当SSO登录出现故障时，仍能够登录并修改账户配置。

***

## 常见问题

**问：为什么在 IdP 登录后，跳转回 Lakehouse 提示“认证失败”？**

**答：**通常是映射字段（Email 或 Phone）在用户间不唯一，或未正确返回/格式有误。如果是映射字段在用户间不唯一，在认证失败的提示中会有明确提示。如未提示映射字段不唯一，则请账户管理员检查身份映射字段的配置是否正确，比如是否回传 Email 但映射为 Phone。

**问：为何勾选了“账户管理员可同时使用云器账号登录”但仍不可使用用户名、密码登录？**

**答：**在开启 SSO 登录且勾选“账户管理员可同时使用云器账号登录”后，仅具备账户管理员角色的用户可以使用用户名、密码登录，其他用户只能使用 SSO 方式登录。

**问：是否可以通过 SDK（如 Python、JDBC）使用 SSO 登录？**

**答：**当前仅支持 Web 登录。Python、JDBC 等方式当前仅支持用户名密码认证方式。
