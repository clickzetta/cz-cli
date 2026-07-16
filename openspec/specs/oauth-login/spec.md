# oauth-login 规格说明

## 目的
定义 cz-cli SDK 认证层（`packages/clickzetta-sdk/src/auth`）接入 ClickZetta OAuth2 授权码 + PKCE 登录的行为：以 OAuth 模式发起登录、用授权码换取 `access_token`/`refresh_token`、token 过期时通过 refresh token 轮换续期、用 access_token 查询 userinfo，并在服务端未启用 OAuth 时保持与传统登录完全兼容。`cz-cli login` 命令以浏览器 loopback OAuth 为默认入口，登录成功后据 userinfo 建立/更新 profile、持久化 OAuth token 并配置 LLM；SDK 仍保留可显式启用的本地回调监听底层能力（`CZ_OAUTH_LOCAL_CALLBACK`）供其他链路复用。

OAuth client 固定为 `official-cli`（public 类型，强制 PKCE），`scope = "openid profile offline_access"`，`redirect_uri = "http://127.0.0.1/callback"`，`codeChallengeMethod = "S256"`。任何错误信息或日志均不得输出 `code_verifier`、授权码明文、`access_token`、`refresh_token`。

## 需求

### 需求：以 OAuth 模式发起登录并生成 PKCE

`loginWithPassword` / `loginWithPat` 在向 `/clickzetta-portal/user/loginSingle` 发起登录时，应在原有请求体基础上附加 `oauthLoginParam` 对象，包含 `oauthLogin = true`、`clientId = "official-cli"`、`redirectUri = "http://127.0.0.1/callback"`、`scope = "openid profile offline_access"`、`codeChallengeMethod = "S256"`，以及由每次登录新生成的 PKCE `code_verifier` 计算出的 `codeChallenge`（`base64url(SHA-256(code_verifier))`，无 padding）。`code_verifier` 仅驻留内存，不得写入磁盘或日志。

#### 场景：登录请求携带 oauthLoginParam 与合法 codeChallenge

- **当** 用户调用 `loginWithPassword(baseUrl, user, pass, instance)` 时
- **则** 发往 `/clickzetta-portal/user/loginSingle` 的请求体保留 `username`/`password`/`instanceName`，并附加 `oauthLoginParam`，其中 `oauthLogin=true`、`clientId="official-cli"`、`redirectUri="http://127.0.0.1/callback"`、`scope="openid profile offline_access"`、`codeChallengeMethod="S256"`
- **且** `oauthLoginParam.codeChallenge` 等于发往 `/oauth2/token` 的 `code_verifier` 的 `base64url(SHA-256(...))`

#### 场景：每次登录生成全新且不复用的 code_verifier（边界）

- **当** 连续发起多次 OAuth 登录时
- **则** 每次生成的 `code_verifier` 长度落在 RFC 7636 规定的 43–128 个 unreserved 字符范围内
- **且** 各次登录的 `code_verifier` 互不相同，不得跨登录复用

### 需求：授权码换取 OAuth Token

当登录响应 `data.authorizationCode` 非空时，CLI 应以 `application/x-www-form-urlencoded` 向 `/oauth2/token` 发起 POST，请求体包含 `grant_type="authorization_code"`、`code`、`client_id="official-cli"`、`redirect_uri="http://127.0.0.1/callback"`、`code_verifier`。成功后将 `access_token` 写入 `AuthToken.token`、`refresh_token` 写入 `AuthToken.refreshToken`、`expires_in`（秒）乘以 1000 写入 `expireTimeMs`，并记录 `obtainedAt`。

#### 场景：授权码换取成功并正确映射 AuthToken

- **当** 登录返回 `authorizationCode` 且 `/oauth2/token` 返回 `access_token`、`refresh_token`、`expires_in=900` 时
- **则** 返回的 `AuthToken.token` 等于 `access_token`、`AuthToken.refreshToken` 等于 `refresh_token`
- **且** `AuthToken.expireTimeMs` 等于 `900 * 1000`

#### 场景：换取失败返回 invalid_grant 错误且不泄露敏感值（异常）

- **当** `/oauth2/token` 对授权码换取返回 `error=invalid_grant`（授权码过期/已使用/校验失败）时
- **则** CLI 抛出标识授权码/校验失败的 `InterfaceError`，且不重复使用同一授权码再次换取
- **且** 错误信息不包含 `code_verifier`、授权码明文、`access_token` 或 `refresh_token`

### 需求：Refresh Token 轮换与续期

当缓存的 token 依据 `EXPIRED_FACTOR = 0.8` 判定为过期且持有 `refreshToken` 时，`getToken` 应优先以 `grant_type="refresh_token"`、`refresh_token`、`client_id="official-cli"` 调用 `/oauth2/token` 续期，而不是重新走完整登录。续期成功后应使用服务端轮换返回的新 `refresh_token` 覆盖旧值，后续续期一律使用最新值。续期失败（如 `invalid_grant`）时应清除缓存并回退到完整登录。

#### 场景：过期 token 用 refresh_token 续期并轮换

- **当** 缓存 token 过期且持有 `refresh-1`，再次调用 `getToken` 时
- **则** CLI 以 `grant_type=refresh_token` 携带 `refresh-1` 调用 `/oauth2/token`，不触发新的门户登录
- **且** 续期成功后缓存的 `refreshToken` 被替换为服务端返回的最新值，下一次续期使用该最新值

#### 场景：续期失败回退完整登录（异常）

- **当** 缓存 token 过期且 refresh 续期返回 `invalid_grant` 时
- **则** CLI 清除失效缓存并执行一次完整门户登录作为回退
- **且** 最终返回经由回退登录获得的新 token

### 需求：查询 UserInfo

CLI 应能以 `Authorization: Bearer <access_token>` 调用 `GET /oauth2/userinfo` 获取当前用户信息，并解析返回字段；处理与展示过程中不得输出 `access_token`、`refresh_token` 等敏感字段。

#### 场景：携带 Bearer 成功获取 userinfo

- **当** 以有效 `access_token` 调用 `fetchUserInfo(baseUrl, accessToken)` 时
- **则** 请求携带 `Authorization: Bearer <access_token>` 头并请求 `/oauth2/userinfo`
- **且** 返回解析后的用户信息字段

#### 场景：access_token 失效返回 invalid_token 且不泄露 token（异常）

- **当** `/oauth2/userinfo` 因 token 失效返回 `error=invalid_token` 时
- **则** CLI 抛出标识认证失败的 `InterfaceError`
- **且** 错误信息不包含 `access_token` 的明文值

### 需求：向后兼容传统登录

未携带 `oauthLoginParam`，或服务端在 OAuth 模式登录响应中未返回非空 `authorizationCode` 时，CLI 应保留登录返回的传统 token（legacy token），不得调用 `/oauth2/token`。`loginWithPat`、`loginWithPassword` 的公开签名保持兼容，传统模式下 `AuthToken` 不含 `refreshToken`，既有重试、退避与实例配置错误识别逻辑不变。

#### 场景：无 authorizationCode 时保留 legacy token

- **当** 登录成功但响应 `data.authorizationCode` 为空时
- **则** 返回的 `AuthToken.token` 等于门户返回的 legacy token
- **且** 调用 `/oauth2/token` 的次数为 0，且 `AuthToken.refreshToken` 为 undefined

#### 场景：仅持有 legacy token 过期时重新登录而非续期（边界）

- **当** 缓存中仅持有过期的 legacy token（无 `refreshToken`）再次调用 `getToken` 时
- **则** CLI 执行一次完整门户登录获取新 token
- **且** 全程不调用 `/oauth2/token`

### 需求：SDK 本地回调监听作为可显式启用的底层能力

CLI 应实现本地 loopback 回调监听流程（`waitForAuthorizationCode`，在 `127.0.0.1` 上一次性接收并校验 `?code=&state=`）。该底层能力由开关 `CZ_OAUTH_LOCAL_CALLBACK`（设为 `1` 或 `true`）门控，用于 SDK 密码/PAT 登录链路是否在登录时联动本地监听；开关未启用时该链路不得启动任何本地监听端口。`cz-cli login` 命令的浏览器入口不依赖该开关（见「`cz-cli login` 命令接入浏览器登录」需求）：无论开关是否启用，`cz-cli login` 默认走浏览器 loopback 授权流程。

#### 场景：未启用开关时 SDK 密码/PAT 链路不启动本地监听

- **当** 未设置 `CZ_OAUTH_LOCAL_CALLBACK`（或其值非 `1`/`true`）执行 SDK 密码/PAT 登录时
- **则** `isLocalCallbackEnabled()` 返回 false
- **且** 该登录链路不调用 `waitForAuthorizationCode`，不占用任何本地端口

#### 场景：启用后能解析授权码并校验 state（边界）

- **当** 设置 `CZ_OAUTH_LOCAL_CALLBACK=1` 并显式调用 `waitForAuthorizationCode` 接收携带 `code` 且 `state` 匹配的回调请求时
- **则** 该方法以解析出的授权码 resolve 并关闭监听
- **且** 当回调缺少 `code` 或 `state` 不匹配时，该方法 reject 并关闭监听，不泄露授权码值

### 需求：Refresh Token 跨进程持久化

登录或刷新成功得到含 `refreshToken` 的 OAuth `AuthToken` 时，CLI 应将 `token`（access_token）、`refreshToken`、`expireTimeMs`、`obtainedAt`、`instanceId`、`userId` 持久化到当前 profile 在 `~/.clickzetta/profiles.toml` 中的条目下（OAuth 子表），复用现有原子写入与 `0o600` 权限机制，且不得将 token 写入任何日志。新进程发起需要 token 的操作时：持久化 token 依据 `EXPIRED_FACTOR = 0.8` 判定未过期则直接复用，不重新登录也不调用 `/oauth2/token`；已过期但含 `refreshToken` 则用该 refresh token 调用 `/oauth2/token` 续期并将轮换后的新值回写持久化存储；续期失败（如 `invalid_grant`）则清除该 profile 的持久化 OAuth token 并回退完整登录。持久化按 profile + instance 维度隔离：OAuth token slot 以 **instance** 作为 key（不再附带 pat/username），不同 profile/instance 的 token 互不串用。OAuth token 代表用户自身的登录身份，移除或轮换 pat/username 不得导致已持久化的 token slot 失联。该机制通过 `ConnectionConfig` 上可选的 `tokenStore` 接口注入到 SDK 认证层；未注入该接口时行为退化为现有纯内存缓存，保持向后兼容。

#### 场景：持久化未过期 token 在新进程直接复用

- **当** 注入了 profile-backed `tokenStore` 且持久化的 access_token 未过期，新进程调用 `getToken` 时
- **则** CLI 直接复用持久化的 access_token，不调用 `/clickzetta-portal/user/loginSingle` 也不调用 `/oauth2/token`
- **且** 不向 profiles.toml 写入新的 token 条目

#### 场景：持久化 refresh token 续期失败回退完整登录（异常）

- **当** 持久化的 token 已过期，CLI 用持久化的 refresh token 调用 `/oauth2/token` 续期返回 `error=invalid_grant` 时
- **则** CLI 清除该 profile 在 profiles.toml 中的持久化 OAuth token 条目，并回退执行一次完整门户登录
- **且** 错误处理与日志不输出 `code_verifier`、授权码明文、`access_token` 或 `refresh_token`

### 需求：持久化 OAuth token 作为 SQL 鉴权凭据

`cz-cli sql` 等需要 token 的命令在 `getExecContext` 中执行鉴权预检：当解析出的 profile 既无 pat 也无 username/password，但其在对应 instance 的 OAuth slot 下存在可加载的持久化 OAuth token（通过注入的 `tokenStore.load()` 取得）时，CLI 应将该持久化 OAuth token 视为充分的鉴权凭据，直接进入取 token / 执行流程，不得抛出缺少凭据错误（`NO_CREDENTIALS` / 以「Authentication required」开头的错误）。当既无 pat/username 也无持久化 OAuth token 时，CLI 应仍抛出以「Authentication required」开头的错误（由错误分类映射为 `NO_CREDENTIALS`），并指引 `--pat`/`--username`/`--password` 或 `cz-cli login`（浏览器 OAuth，或 `--credential <b64>`）。

#### 场景：纯 OAuth profile 用持久化 token 执行 SQL 不报 NO_CREDENTIALS

- **当** 某 profile 无 pat 且无 username/password，但其在 instance 对应的 OAuth slot 下存在持久化的 OAuth token，执行 `cz-cli sql` 触发 `getExecContext` 鉴权预检时
- **则** 预检通过，不抛出以「Authentication required」开头的缺少凭据错误，直接使用该持久化 OAuth token 鉴权

#### 场景：既无凭据又无 OAuth token 时仍报鉴权缺失（边界）

- **当** 某 profile 既无 pat/username/password，也无任何持久化 OAuth token，执行 `cz-cli sql` 触发鉴权预检时
- **则** CLI 抛出以「Authentication required」开头的错误（映射为 `NO_CREDENTIALS`），并指引 `--pat`/`--username`/`--password` 或 `cz-cli login`（浏览器 OAuth，或 `--credential <b64>`）

### 需求：浏览器 loopback 授权流程（动态 redirect_uri）

当开关 `CZ_OAUTH_LOCAL_CALLBACK` 启用时，CLI 应走标准 OAuth 浏览器 loopback 授权流程：先在 `127.0.0.1` 上以系统分配的随机端口启动一次性 HTTP 监听，据实际端口生成动态 `redirect_uri = "http://127.0.0.1:<port>/callback"`；将 `oauthLoginParam`（含 `oauthLogin=true`、`clientId`、动态 `redirectUri`、`scope`、`codeChallenge`、`codeChallengeMethod="S256"`、随机 `state`）序列化为 JSON 并 base64 编码，作为 query 参数 `oauthLoginParam` 拼接到 accounts 登录页 URL，随后打开系统默认浏览器访问该 URL 并在终端打印该 URL 以便手动打开；前端登录成功后回跳 `http://127.0.0.1:<port>/callback?code=...&state=...`，本地监听校验 `state` 与本次发起值一致后取出 `code` 并关闭监听；CLI 再以与监听阶段**完全一致**的动态 `redirect_uri`、`client_id`、`code_verifier` 调用 `/oauth2/token` 换取 token。`redirect_uri` 不再硬编码为固定 `http://127.0.0.1/callback`，换 token 接口接受调用方传入的 `redirect_uri`。流程全程不得在日志中输出 `code_verifier`、授权码明文、`access_token`、`refresh_token`，`state` 仅用于一次性校验。开关未启用时保持现有默认路径，不启动本地监听、不打开浏览器。

#### 场景：动态 redirect_uri 在 authorize URL 与换 token 时逐字一致

- **当** 启用浏览器 loopback 流程，本地监听在随机端口 `<port>` 就绪并据此生成 `redirect_uri = "http://127.0.0.1:<port>/callback"` 时
- **则** 拼接到 accounts 登录页的 `oauthLoginParam`（base64-JSON 解码后）中 `redirectUri` 等于该动态 `redirect_uri`
- **且** 前端回跳取得 `code` 后，调用 `/oauth2/token` 携带的 `redirect_uri` 与 authorize URL 内的 `redirectUri` 逐字相同，且等于 `http://127.0.0.1:<实际监听端口>/callback`

#### 场景：state 不匹配或回调超时则失败且不换 token（异常）

- **当** 本地监听收到的回调 `state` 与本次发起生成的随机 `state` 不一致，或在超时时间内未收到回调时
- **则** CLI 终止登录并返回明确错误，关闭本地监听
- **且** 不以错误或伪造的 `code` 继续调用 `/oauth2/token`，错误信息不输出 `code_verifier`、授权码明文、`access_token` 或 `refresh_token`

### 需求：`cz-cli login` 自适应登录入口（默认浏览器 OAuth 并建 profile + 配 LLM）

CLI 应提供顶层命令 `cz-cli login` 作为统一的自适应认证入口，复用全局连接参数（`--profile`/`--instance`/`--service` 等）解析当前 `ConnectionConfig`，并按 argv 分派：

- **`--credential <b64>`** → 新用户凭证路径：解码 base64(JSON) 凭证，据此创建 `--name`（缺省 `default`）指定的 profile、设为默认 profile，并据凭证中的 `apiKey`/`aimeshEndpointBaseUrl` 配置 ClickZetta LLM；凭证非法或 profile 已存在时分别以 `INVALID_CREDENTIAL`/`PROFILE_EXISTS` 报错且不持久化。
- **`--pat`、`--username`/`--password`、`--login-method`、`--login`**（显式非交互凭证或门户发现信号）→ 委托共享的非交互/门户发现配置流程（与 `setup` 别名同一套实现），覆盖 CI/agent 与 username/password 门户发现。
- **默认（未带任何上述凭证 flag）** → 浏览器 loopback 授权流程（见「浏览器 loopback 授权流程」需求），自动拉起系统浏览器并在终端打印 authorize URL。`--browser` 保留为隐藏 no-op（浏览器已是默认），不再作为启用开关；`cz-cli login` 的浏览器入口不因缺少 `--browser` 或未设 `CZ_OAUTH_LOCAL_CALLBACK` 而报错或拒绝登录。

默认浏览器路径成功取得 token 后，CLI 应调用 `/oauth2/userinfo` 查询当前用户信息，把其中的 `userId`（缺省回退解析 `sub`）与 `instanceId`（`instanceList[0].id`）回填到待持久化的 `AuthToken`（仅当为有效正整数时覆盖）。CLI 应在目标 profile 不存在时先据 userinfo 建立该 profile（新建即"覆盖 setup"的核心链路），并将 userinfo 中有用的字段**扁平映射**到该 profile 条目顶层、各归其规范位置：连接上下文 `service`/`protocol`/`instance`/`workspace`/`schema`/`vcluster`/`user_id`，映射自 `account_id`/`accountName` 的 `account_id`/`account_name`，以及按原名写入的 `aimeshEndpointBaseUrl`（与 `--credential` 路径写入同一字段，供 `clickzetta-rotation`/`ai-gateway` 复用）；其中 `instance` 优先取 userinfo 的 `instanceName`（缺省回退 `instanceList[0].name`）。CLI **不**将完整 userinfo 响应体另存为 `[profiles.<name>.userinfo]` 子表：每个消费者所需字段都有顶层规范归宿（连接字段 + `aimeshEndpointBaseUrl`，`apiKey` 入 `llm.json`），原样归档只会重复存储并带来漂移风险，故 `instanceList`/`gatewayMapping`/`sub`/`preferred_username`/`name` 等无顶层归宿且当前无消费者的字段一律丢弃。CLI 还应据 userinfo 的 `apiKey`/`aimeshEndpointBaseUrl` 配置 ClickZetta LLM（`apiKey` 缺失时跳过 LLM 配置）。随后按最终 `instance` 作为 token slot key（仅按 instance，不含 pat/username）通过该 profile 的 token 存储（见「Refresh Token 跨进程持久化」需求）持久化 token，并将该 profile 设为默认 profile，输出成功结果（含 `logged_in`/`instance`/`workspace`/`user_id`/`llm_configured`/`expires_in_ms`），且不回显 `access_token`、`refresh_token` 等敏感值。`/oauth2/userinfo` 查询失败（如 `invalid_token`、网络异常）视为非致命：保留已换取的 token 完成登录、不写回连接上下文、不配置 LLM，不得使整体登录失败，也不得在日志输出 token 明文（最多以 `CZ_OAUTH_DEBUG` 输出 userinfo 字段名）。若登录失败（`state` 不匹配、超时、换 token 失败等），CLI 应返回明确错误并以非零退出码结束，且不持久化任何 token。CLI 不移除服务端未启用 OAuth 时的 legacy 门户 token 回退（见「向后兼容传统登录」需求）：OAuth 是替代交互入口，而非删除 legacy 认证。

#### 场景：默认浏览器登录成功并持久化 token 且输出不含敏感值

- **当** 执行 `cz-cli login`（未带任何凭证 flag）且浏览器 loopback 流程成功换取到 OAuth token 时
- **则** CLI 通过当前 profile 的 token 存储持久化该 token（含 `access_token`、`refreshToken`、`expireTimeMs`、`userId`），并输出登录成功结果
- **且** 成功输出不包含 `access_token` 或 `refresh_token` 的明文值，退出码为 0，无需传入 `--browser` 或设置 `CZ_OAUTH_LOCAL_CALLBACK`

#### 场景：默认浏览器登录从零建 profile 并配置 LLM

- **当** 执行 `cz-cli login` 时目标 profile 尚不存在，浏览器登录成功且 `/oauth2/userinfo` 返回含 `instanceName`/`workspaceName`/`apiKey`/`aimeshEndpointBaseUrl` 的响应体时
- **则** CLI 据 userinfo 建立该 profile（连接字段齐全）、将其设为默认 profile，并在 `llm.json` 写入 `provider="clickzetta"`、`api_key`（取 `apiKey`）、`base_url`（取 `aimeshEndpointBaseUrl`）的 LLM 条目
- **且** 成功输出的 `llm_configured` 为 `true`，且不回显 `apiKey`/`access_token`/`refresh_token` 明文

#### 场景：`--credential` 路径建 profile + 配 LLM 等价于原 setup（新用户）

- **当** 执行 `cz-cli login --credential <b64> --name <name>` 且凭证含 `instanceName`/`accessToken`/`apiKey`/`aimeshEndpointBaseUrl` 时
- **则** CLI 创建 `<name>` profile（`instance`/`workspace`/`schema`/`vcluster`/`pat`/`service`/`protocol` 等字段与凭证一致）、设为默认，并在 `llm.json` 配置 ClickZetta LLM，退出码 0，不发起浏览器 loopback 流程
- **且（边界）** 凭证 base64/JSON 非法时以 `INVALID_CREDENTIAL` 报错、目标 profile 已存在时以 `PROFILE_EXISTS` 报错，两种情况均不持久化、不覆盖既有 profile

#### 场景：userinfo 回填身份与连接上下文并写回 profile

- **当** 浏览器登录换取 token 成功后，`/oauth2/userinfo` 返回 `userId=110000011361`、`instanceList[0].id=159973`、`instanceName="89b94150"`、`workspaceName="quick_start"`、`schema="public"`、`virtualCluster="DEFAULT_AP"` 时
- **则** 待持久化的 `AuthToken.userId` 被回填为 `110000011361`、`AuthToken.instanceId` 被回填为 `159973`，并将 `service`/`protocol`/`instance`（取 `89b94150`）/`workspace`/`schema`/`vcluster`/`user_id` 写回当前 profile 条目
- **且** token 以最终 instance slot key `89b94150`（仅按 instance，不含 pat/username）持久化，后续 `resolveConnectionConfig` 能据此找回该 token

#### 场景：userinfo 扁平映射到 profile 顶层且不另存 userinfo 子表

- **当** 浏览器登录成功后 `/oauth2/userinfo` 返回完整响应体（含 `aimeshEndpointBaseUrl`、`apiKey`、`account_id=112407`、`accountName="wynptmks"`，以及 `instanceList` 对象数组、`gatewayMapping` JSON 字符串等字段）时
- **则** CLI SHALL 把有用字段扁平写入当前 profile 条目顶层各自的规范位置：连接字段、`account_id`/`account_name`，以及按原名写入的 `aimeshEndpointBaseUrl`；`apiKey` 写入 `llm.json`；写入复用原子写入与 `0o600` 权限机制
- **且** CLI SHALL NOT 在 profile 条目下创建 `[profiles.<name>.userinfo]` 子表；`instanceList`/`gatewayMapping`/`sub`/`preferred_username`/`name` 等无顶层归宿的字段被丢弃
- **且（边界/安全）** `apiKey` 等敏感值仅随 `0o600` 文件存储，不出现在登录成功输出或任何日志中；写入不触碰该 profile 的 `oauth` 子表与其他无关字段

#### 场景：userinfo 查询失败时登录仍成功（边界）

- **当** 浏览器登录换取 token 成功，但随后 `/oauth2/userinfo` 返回 `error=invalid_token`（HTTP 401）或网络异常时
- **则** CLI 仍以已换取的 token 完成登录，`userId`/`instanceId` 维持默认值 0，不写回 userinfo 派生的连接上下文
- **且** 整体登录不因 userinfo 失败而失败，日志不输出 `access_token`/`refresh_token` 明文

#### 场景：显式非交互凭证委托共享配置流程而非浏览器（边界）

- **当** 执行 `cz-cli login --pat <PAT>`（或 `--username`/`--password`、`--login-method`、`--login`）时
- **则** CLI 委托共享的非交互/门户发现配置流程（与 `setup` 别名同一实现），不发起浏览器 loopback 流程，也不打开系统浏览器
- **且** 该路径的建 profile / 校验行为与经由 `setup` 执行时逐字一致（同一套底层逻辑）

#### 场景：浏览器登录失败时非零退出且不持久化（异常）

- **当** 执行 `cz-cli login` 默认浏览器路径但 loopback 流程因 `state` 不匹配、回调超时或换 token 失败而抛错时
- **则** CLI 返回明确错误并以非零退出码结束
- **且** 不向 profile 的 token 存储写入任何 token，错误信息不输出 `code_verifier`、授权码明文、`access_token` 或 `refresh_token`
