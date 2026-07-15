# Requirements Document

> cz-cli OAuth2 登录接入

## Introduction

当前 cz-cli 在登录 ClickZetta 服务时，使用 `/clickzetta-portal/user/loginSingle` 接口，通过 PAT 或用户名/密码换取传统会话 token（`AuthToken`）。为了对接服务端新引入的 OAuth2 授权码流程（Authorization Code + PKCE），需要对 CLI 的登录链路做改造，使其能够获取 OAuth `access_token` / `refresh_token`，并在 token 过期时通过 refresh token 轮换续期。

本期的关键约束：登录前端 Web 服务尚未就绪，浏览器登录成功后**暂时无法回调 CLI 的本地监听服务**回传 authorization code。因此本期以**手动粘贴授权码**作为默认获取方式；同时实现（但默认禁用）本地回调监听流程，待前端就绪后可通过开关启用，无需再次改造核心链路。

本需求遵循服务端鉴权测试文档 `oauth-login-integration-test.md` 所定义的接口契约：
- `/clickzetta-portal/user/login`、`/clickzetta-portal/user/loginSingle`：在请求体携带 `oauthLoginParam` 时，登录成功返回 `authorizationCode`。
- `/oauth2/token`：用授权码换取 `access_token` + `refresh_token`，并支持 refresh token 轮换。
- `/oauth2/userinfo`：使用 Bearer `access_token` 查询当前用户信息。

OAuth client 固定为 `official-cli`（public 类型，强制 PKCE），scope 为 `openid profile offline_access`，redirect_uri 为 `http://127.0.0.1/callback`，授权码 TTL 120 秒且一次性使用。

## Glossary

| 术语 | 说明 |
|------|------|
| OAuth 登录模式 | 在登录请求体中携带 `oauthLoginParam.oauthLogin = true`，使服务端在登录成功后额外签发 authorization code 的登录方式 |
| 传统登录模式 | 不携带 `oauthLoginParam` 的现有登录方式，返回原有会话 token，不返回非空 authorizationCode |
| PKCE | Proof Key for Code Exchange。CLI 生成 `code_verifier`，对其做 SHA-256 后 base64url 编码得到 `code_challenge`（method `S256`） |
| authorization code | 登录成功后服务端签发的一次性授权码，TTL 120 秒，用于换取 token |
| access_token | OAuth 访问令牌，用于访问受保护资源与 `/oauth2/userinfo` |
| refresh_token | OAuth 刷新令牌，用于轮换出新的 access_token；每次刷新后服务端会轮换（rotate）出新的 refresh_token |
| 手动粘贴流程 | 默认流程：CLI 引导用户在浏览器登录并复制授权码，用户将授权码粘贴回 CLI |
| 本地回调流程 | 未来流程：CLI 在 loopback redirect_uri 启动本地 HTTP 监听，由浏览器重定向自动回传授权码（本期实现但默认禁用） |
| `AuthToken` | SDK 内部令牌结构，定义于 `packages/clickzetta-sdk/src/types/index.ts` |

## Requirements

### 需求 1：以 OAuth 模式发起登录

**用户故事：** 作为 cz-cli 用户，我希望在登录时以 OAuth 模式向服务端发起请求，以便登录成功后能获得 authorization code 用于换取 OAuth token。

#### 验收标准

1. WHEN 用户以 OAuth 登录模式调用 `loginWithPassword` THEN CLI SHALL 在 `/clickzetta-portal/user/loginSingle` 请求体中除原有 `username`、`password`、`instanceName` 外，附加 `oauthLoginParam` 对象。
2. WHERE 携带 `oauthLoginParam` THE CLI SHALL 设置 `oauthLogin = true`、`clientId = "official-cli"`、`redirectUri = "http://127.0.0.1/callback"`、`scope = "openid profile offline_access"`、`codeChallengeMethod = "S256"`。
3. WHEN 构造 `oauthLoginParam` THEN CLI SHALL 生成 PKCE `code_verifier` 并将其 SHA-256 的 base64url 编码作为 `codeChallenge`，且保留 `code_verifier` 供后续换取 token 使用。
4. WHEN 登录请求成功且响应 `data.authorizationCode` 非空 THEN CLI SHALL 进入授权码换取 token 流程（见需求 4）。
5. IF 服务端返回业务错误码（`code` 非 0/200）THEN CLI SHALL 复用现有重试与错误处理逻辑（最多重试、退避、实例配置错误识别），不得因附加 `oauthLoginParam` 而改变既有重试语义。

### 需求 2：PKCE 参数生成

**用户故事：** 作为安全负责人，我希望 CLI 每次发起 OAuth 登录都生成符合规范的 PKCE 参数，以防止授权码被截获后被他人使用。

#### 验收标准

1. WHEN 发起一次 OAuth 登录 THEN CLI SHALL 生成一个高熵随机 `code_verifier`，其字符集与长度满足 RFC 7636（43–128 个 unreserved 字符）。
2. WHEN 由 `code_verifier` 计算 `code_challenge` THEN CLI SHALL 使用 `base64url(SHA-256(code_verifier))` 且不含 padding（`=`）。
3. THE CLI SHALL 为每一次登录尝试生成全新的 `code_verifier` / `code_challenge`，不得跨登录复用。
4. WHILE 在 `code_verifier` 被用于换取 token 之前 THE CLI SHALL 仅在内存中持有该值，不得写入磁盘或日志。

### 需求 3：获取授权码（手动粘贴默认，本地回调备用）

**用户故事：** 作为 cz-cli 用户，由于登录前端暂未就绪无法自动回传授权码，我希望能在浏览器登录后手动粘贴授权码完成登录；同时希望工具已为未来的自动回传做好准备。

#### 验收标准

1. THE CLI SHALL 默认采用手动粘贴流程获取 authorization code。
2. WHEN 采用手动粘贴流程 THEN CLI SHALL 打开（或提示用户打开）浏览器登录页面，并提示用户在登录成功后将授权码粘贴回 CLI。
3. WHEN 用户粘贴授权码 THEN CLI SHALL 去除首尾空白后作为 authorization code 进入换取 token 流程。
4. IF 用户提交空字符串或取消输入 THEN CLI SHALL 终止本次登录并返回明确的错误提示，不得继续调用 `/oauth2/token`。
5. THE CLI SHALL 实现本地回调监听流程（在 `http://127.0.0.1/callback` 对应的 loopback 端口启动本地 HTTP 监听以接收授权码），但 THE 该流程 SHALL 默认禁用，由配置开关或标志控制启用。
6. WHILE 本地回调流程处于禁用状态 THE CLI SHALL 不启动本地监听端口，仅使用手动粘贴流程。
7. WHERE 当前 `loginWithPassword` 已在一次请求中同时完成登录与授权码签发（服务端在登录响应中直接返回 `authorizationCode`）THE CLI SHALL 支持该“免浏览器”的直接授权码获取路径，作为手动粘贴流程的实现基础，并保持与需求 4 一致的换取逻辑。

### 需求 4：授权码换取 OAuth Token

**用户故事：** 作为 cz-cli 用户，我希望工具用授权码换取 access_token 与 refresh_token，以便后续用 OAuth token 访问服务。

#### 验收标准

1. WHEN 持有非空 authorization code 与对应 `code_verifier` THEN CLI SHALL 以 `application/x-www-form-urlencoded` 向 `/oauth2/token` 发起 POST 请求。
2. WHERE 调用 `/oauth2/token` 换取授权码 THE 请求体 SHALL 包含 `grant_type = "authorization_code"`、`code`（授权码）、`client_id = "official-cli"`、`redirect_uri = "http://127.0.0.1/callback"`、`code_verifier`。
3. WHEN `/oauth2/token` 返回成功 THEN CLI SHALL 从响应中读取 `access_token`、`refresh_token`、`expires_in`、`token_type`。
4. WHEN 构造内部 `AuthToken` THEN CLI SHALL 将 `access_token` 写入 `token` 字段、将 `refresh_token` 写入新增的 `refreshToken` 字段、将 `expires_in`（秒）换算为毫秒写入 `expireTimeMs`，并记录 `obtainedAt`。
5. THE `AuthToken` 接口 SHALL 新增可选 `refreshToken` 字段以承载 OAuth refresh token，且不破坏传统登录模式下不含该字段的既有用法。
6. WHEN 授权码必须在 TTL（120 秒）内使用 THEN CLI SHALL 在拿到授权码后尽快发起换取，并在授权码过期时返回明确错误（见需求 7）。

### 需求 5：Refresh Token 轮换与续期

**用户故事：** 作为 cz-cli 用户，我希望 access_token 过期时工具能用 refresh_token 自动续期，以便长时间使用而无需重复登录。

#### 验收标准

1. WHEN 检测到 access_token 已过期（依据现有 `EXPIRED_FACTOR = 0.8` 的过期判定）且持有 refresh_token THEN CLI SHALL 优先使用 refresh_token 续期，而非重新走完整登录。
2. WHERE 使用 refresh_token 续期 THE CLI SHALL 向 `/oauth2/token` 发起 POST，请求体包含 `grant_type = "refresh_token"`、`refresh_token`、`client_id = "official-cli"`。
3. WHEN 续期成功返回新的 `access_token` 与 `refresh_token` THEN CLI SHALL 用新的 refresh_token 覆盖旧值，后续续期一律使用最新的 refresh_token。
4. IF refresh_token 续期失败（如 refresh_token 失效，服务端返回 `invalid_grant`）THEN CLI SHALL 清除已失效的 token 并回退到完整登录流程或返回明确错误。
5. WHILE 仅持有传统会话 token（无 refresh_token）THE CLI SHALL 保持现有 `forceRefreshToken` 的重新登录行为，不调用 `/oauth2/token`。

### 需求 6：查询 UserInfo

**用户故事：** 作为 cz-cli 用户，我希望工具能用 access_token 查询当前用户信息，以确认登录身份。

#### 验收标准

1. WHEN 需要获取当前 OAuth 用户信息 THEN CLI SHALL 以 `Authorization: Bearer <access_token>` 头调用 `GET /oauth2/userinfo`。
2. WHEN `/oauth2/userinfo` 返回成功 THEN CLI SHALL 解析并返回用户信息字段。
3. THE CLI SHALL NOT 在 userinfo 的处理或展示中输出 access_token、refresh_token 等敏感字段。
4. IF access_token 为空或已过期导致 `/oauth2/userinfo` 返回 `invalid_token` THEN CLI SHALL 触发续期（见需求 5）或返回明确的认证失败错误。

### 需求 7：错误处理与负向场景

**用户故事：** 作为 cz-cli 用户，我希望在 OAuth 流程出错时获得清晰、可操作的错误信息，而不是泄露敏感信息或静默失败。

#### 验收标准

1. WHEN 服务端返回 `invalid_request`（缺少 `codeChallenge`、`codeChallengeMethod` 非 `S256`、`redirectUri` 不在白名单等）THEN CLI SHALL 返回指明请求参数问题的错误。
2. WHEN 服务端返回 `invalid_client`（client 配置缺失）THEN CLI SHALL 返回指明 OAuth client 配置问题的错误。
3. WHEN 服务端返回 `invalid_scope`（请求 scope 越权）THEN CLI SHALL 返回指明 scope 越权的错误。
4. WHEN 服务端返回 `invalid_grant`（授权码过期、授权码已被使用、`redirect_uri` 不一致、`code_verifier` 与 `code_challenge` 不匹配）THEN CLI SHALL 返回指明授权码/校验失败的错误，并不得重复使用同一授权码再次换取。
5. WHEN 服务端返回 `invalid_token`（access_token 无效/过期）THEN CLI SHALL 按需求 5/6 处理续期或返回认证失败。
6. IF 任何 OAuth 步骤失败 THEN CLI SHALL NOT 在错误信息或日志中输出 `code_verifier`、authorization code 明文、access_token、refresh_token 等敏感值。
7. WHILE 处于 OAuth 流程 THE CLI SHALL 保留现有登录的请求关联标识（requestId）以便服务端日志排查。

### 需求 8：向后兼容传统登录

**用户故事：** 作为现有 cz-cli 用户，我希望在服务端未启用 OAuth 或我未选择 OAuth 模式时，登录行为与现状完全一致，以便平滑过渡。

#### 验收标准

1. WHEN 登录请求未携带 `oauthLoginParam`（传统登录模式）THEN CLI SHALL 保持现有行为，返回原会话 token 且不进行授权码换取。
2. WHEN 服务端在 OAuth 模式登录响应中未返回非空 `authorizationCode` THEN CLI SHALL 保留登录返回的传统 token（legacy token），且 SHALL NOT 调用 `/oauth2/token`。
3. THE 改造 SHALL 保持 `loginWithPat`、`loginWithPassword` 的现有公开函数签名兼容，不破坏既有调用方。
4. WHERE 传统登录模式 THE `AuthToken` SHALL 不包含 `refreshToken` 字段（或其为 undefined），且现有依赖 `AuthToken` 的代码不受影响。
5. THE 既有登录重试、退避（最多 5 次重试、`min(2^n*100, 2000)` ms 退避、单次 10s 超时）、实例配置错误识别（"没有这样的元素" / "No such element"）SHALL 在 OAuth 改造后继续成立。

### 需求 9：Refresh Token 跨进程持久化

**用户故事：** 作为 cz-cli 用户，我希望登录拿到的 OAuth token（含 refresh token）能持久化到本地 profile，以便后续命令在不同进程中复用，token 未过期时免登录、过期时用 refresh token 续期，而不必每条命令都重新走完整登录。

#### 验收标准

1. WHEN 一次登录或刷新成功得到含 `refreshToken` 的 `AuthToken` THEN CLI SHALL 将 `token`（access_token）、`refreshToken`、`expireTimeMs`、`obtainedAt`、`instanceId`、`userId` 持久化到当前 profile 在 `~/.clickzetta/profiles.toml` 中的条目下（OAuth 子表）。
2. WHERE 写入 profiles.toml THE CLI SHALL 复用现有的原子写入与 `0o600` 权限机制，不得降低文件权限，不得将 token 写入任何日志。
3. WHEN 新进程发起需要 token 的操作且持久化的 token 未过期（依据现有 `EXPIRED_FACTOR = 0.8` 判定）THEN CLI SHALL 直接复用持久化的 access_token，SHALL NOT 重新登录或调用 `/oauth2/token`。
4. WHEN 持久化的 token 已过期但含 `refreshToken` THEN CLI SHALL 使用该 refresh token 调用 `/oauth2/token` 续期，并将轮换后的新 token 回写持久化存储。
5. IF 使用持久化的 refresh token 续期失败（如 `invalid_grant`）THEN CLI SHALL 清除该 profile 的持久化 OAuth token，并回退到完整登录流程。
6. WHERE 持久化按 profile + instance 维度隔离 THE CLI SHALL 以 profile 条目下、按 **instance**（而非 pat/username）作为 token slot key 存储 OAuth token，确保不同 profile/instance 的 token 互不串用；OAuth token 代表用户自身登录，移除或轮换 pat/username 不得导致已持久化的 token slot 失联。
7. THE 持久化机制 SHALL 通过 `ConnectionConfig` 上一个可选的 token 存储接口注入到 SDK 认证层；WHERE 未注入该接口（如直接使用 SDK 的调用方）THE 行为 SHALL 退化为现有的纯内存缓存，保持向后兼容。
8. WHILE 传统登录（无 refreshToken 的 legacy token）THE CLI MAY 持久化 access_token 以复用未过期会话，但 SHALL NOT 因此改变 legacy token 过期后重新登录的既有行为。

### 需求 10：浏览器 loopback 授权流程（动态 redirect_uri）

**用户故事：** 作为 cz-cli 用户，当开启本地回调流程时，我希望 CLI 在本地随机端口起一个一次性监听服务、用该端口生成 `redirect_uri`、打开浏览器到 accounts 登录页，登录成功后由前端把授权码回跳到本地监听，CLI 再用同一 `redirect_uri` 换取 token，从而获得标准 OAuth 浏览器登录体验。服务端对 `127.0.0.1` 的 redirect_uri 校验忽略端口。

#### 验收标准

1. WHILE 开关 `CZ_OAUTH_LOCAL_CALLBACK` 启用 THE CLI SHALL 走浏览器 loopback 授权流程；WHILE 未启用 THE CLI SHALL 保持现有默认路径（手动/凭据直接返回授权码），不启动本地监听、不打开浏览器。
2. WHEN 发起浏览器 loopback 流程 THEN CLI SHALL 先在 `127.0.0.1` 上以系统分配的随机端口启动一次性 HTTP 监听，并据实际端口生成 `redirect_uri = "http://127.0.0.1:<port>/callback"`。
3. WHEN 构造浏览器 authorize URL THEN CLI SHALL 将 `oauthLoginParam`（含 `oauthLogin=true`、`clientId`、动态 `redirectUri`、`scope`、`codeChallenge`、`codeChallengeMethod="S256"`、随机 `state`）序列化为 JSON 并 base64 编码，作为 query 参数 `oauthLoginParam` 拼接到 accounts 登录页 URL（示例：`https://accounts.clickzetta.com/login?oauthLoginParam=<base64-json>`）。
4. WHERE 推导 accounts 登录页 host THE CLI SHALL 依据当前 `service` 的环境推导（prod → `accounts.<rootDomain>`，dev/sit/uat → `<env>-accounts.<rootDomain>`），并允许通过配置（环境变量或 profile）覆盖。
5. WHEN authorize URL 就绪 THEN CLI SHALL 打开系统默认浏览器访问该 URL，并在终端同时打印该 URL 以便手动打开。
6. WHEN 前端登录成功回跳 `http://127.0.0.1:<port>/callback?code=...&state=...` THEN 本地监听 SHALL 校验 `state` 与本次发起的值一致后取出 `code`，随即关闭监听。
7. IF 回调缺少 `code`、`state` 不匹配，或在超时时间内未收到回调 THEN CLI SHALL 终止登录并返回明确错误，且不得用错误/伪造的 code 继续换 token。
8. WHEN 取得 `code` THEN CLI SHALL 以与第 2 步**完全一致**的动态 `redirect_uri`、`client_id`、`code_verifier` 调用 `/oauth2/token` 换取 token（`redirect_uri` 两处必须逐字一致）。
9. THE `redirect_uri` SHALL 不再硬编码为固定 `http://127.0.0.1/callback`；换取 token 的接口 SHALL 接受调用方传入的 `redirect_uri`，由登录流程统一决定其取值。
10. WHILE 浏览器 loopback 流程进行中 THE CLI SHALL NOT 在日志中输出 `code_verifier`、授权码明文、`access_token`、`refresh_token`；`state` 仅用于一次性校验。

### 需求 11：`cz-cli login` 命令接入浏览器登录

**用户故事：** 作为 cz-cli 用户，我希望有一个 `cz-cli login` 命令直接发起浏览器 OAuth 登录，自动拉起系统浏览器完成登录并把 token 持久化到当前 profile，这样后续命令可直接复用。

#### 验收标准

1. THE CLI SHALL 提供顶层命令 `cz-cli login`，复用全局连接参数（`--profile`/`--instance`/`--service` 等）解析当前 `ConnectionConfig`。
2. WHEN 执行 `cz-cli login --browser`，或在 `CZ_OAUTH_LOCAL_CALLBACK` 启用时执行 `cz-cli login` THEN CLI SHALL 走浏览器 loopback 授权流程（需求 10），自动拉起系统浏览器并打印 authorize URL。
3. WHEN 浏览器登录成功取得 token THEN CLI SHALL 通过该 profile 的 token 存储持久化 token（需求 9），并输出成功结果（不回显 access_token/refresh_token 等敏感值）。
4. IF 登录失败（state 不匹配、超时、换 token 失败等）THEN CLI SHALL 返回明确错误并以非零退出码结束，不持久化任何 token。
5. WHERE 既未传 `--browser` 也未启用 `CZ_OAUTH_LOCAL_CALLBACK` THE `cz-cli login` SHALL 提示当前为浏览器登录入口并指引启用方式（不静默改变现有默认登录路径）。
6. WHEN 浏览器登录成功取得 token THEN CLI SHALL 调用 `/oauth2/userinfo` 查询当前用户信息，并将其中的 `userId`（`userId` 数字，缺省时回退解析 `sub`）与 `instanceId`（`instanceList[0].id`）回填到待持久化的 `AuthToken`，仅当解析出的值为有效正整数时覆盖原值；同时将登录上下文（`service`/`protocol`/`instance`/`workspace`/`schema`/`vcluster`/`user_id`）写回当前 profile 条目，其中 `instance` 优先取 userinfo 的 `instanceName`（缺省回退 `instanceList[0].name` 或解析得到的实例），并按最终 `instance` 作为 token slot key（**仅按 instance，不含 pat/username**）持久化 token，使后续命令可直接复用。
7. IF `/oauth2/userinfo` 查询失败（如返回 `invalid_token`、网络异常）THEN CLI SHALL 视为非致命：保留已换取的 token 完成登录（`userId`/`instanceId` 维持默认值 0、不写回连接上下文），SHALL NOT 因 userinfo 失败而使整体登录失败，且不得在日志中输出 access_token/refresh_token 等敏感值（最多以 `CZ_OAUTH_DEBUG` 输出 userinfo 字段名）。
8. WHEN `cz-cli sql`（及其他消费 token 的命令）解析出的 profile 既无 pat 也无 username/password，但该 profile 在对应 instance 的 OAuth slot 下存在可加载（未过期或可凭 refresh token 续期）的持久化 OAuth token THEN CLI SHALL 将该持久化 OAuth token 视为充分的鉴权凭据，直接据此鉴权，SHALL NOT 抛出 `NO_CREDENTIALS`/"Authentication required" 缺少凭据错误；IF 既无 pat/username 也无持久化 OAuth token THEN CLI SHALL 仍报缺少鉴权的错误并指引登录方式（`--pat`/`--username`/`--password`、`cz-cli login --browser` 或 `cz-cli setup`）。
9. WHEN 浏览器登录成功并调用 `/oauth2/userinfo` 取得响应体 THEN CLI SHALL 将该 userinfo **完整、原样、无损**地持久化到当前 profile 条目下的 `[profiles.<name>.userinfo]` 子表（不丢弃任何字段，包括 `instanceList` 对象数组、`gatewayMapping` JSON 字符串、`aimeshEndpointBaseUrl`、`apiKey` 等），并额外将 `account_id`（来自 `account_id`，数字）与 `account_name`（来自 `accountName`，字符串）映射到 profile 条目；WHERE 写入 THE CLI SHALL 复用现有原子写入与 `0o600` 权限机制，敏感值（如 `apiKey`）随该 `0o600` 文件存储，SHALL NOT 打印到成功输出或任何日志；IF userinfo 查询失败 THEN CLI SHALL NOT 写入 `userinfo` 子表（视为非致命，见 11.7）。
