/**
 * 标准 OAuth 2.0 Device Authorization Grant（RFC 8628）验证脚本。
 *
 * 和 oauth-standard-demo.ts 同源，验证的是另一条流程：那个用授权码 + 浏览器
 * loopback，这个用设备码 + 手机扫码。除了账号选择那一段，全程只用 openid-client
 * 的标准实现，所以任何标准客户端（Java/Go/Python 的 OAuth 库）行为都和它一致。
 *
 * - discovery：读取 RFC 8414 Authorization Server Metadata
 * - initiateDeviceAuthorization：申请 device_code 和 user_code
 * - pollDeviceAuthorizationGrant：按服务端 interval 轮询 token endpoint
 * - fetchProtectedResource：携带 access token 请求 userinfo
 *
 * 唯一的非标准部分是多平台账号选择：一个第三方身份绑定了多个 ClickZetta 账号时，
 * 标准 token endpoint 只会一直返回 authorization_pending，必须先走网关的私有状态
 * 接口把账号选定。CLI 里这段逻辑在 src/commands/device-account-select.ts。
 *
 * /oauth2/device_authorization 要求二者之一，不带任何一个直接返回 invalid_request：
 *   - provider=ALIPAY|WECHAT|FEISHU|DINGTALK  第三方扫码
 *   - auth_method=password                     跳前端页面输 ClickZetta 账号密码
 * 注意 provider=PASSWORD 是 400：password 在这个端点上是 auth method 不是 provider。
 * 也就是说这条流程始终需要一个人在验证页上完成登录，不是"无浏览器兜底"。
 *
 * 身份还没绑定 ClickZetta 用户不是失败：网关把设备会话停在等待态，由验证页承接绑定或
 * 注册，脚本这侧只是继续轮询，不需要任何额外参数。
 *
 *   bun script/oauth-device-demo.ts
 *   bun script/oauth-device-demo.ts https://uat-api.clickzetta.com WECHAT
 *   bun script/oauth-device-demo.ts https://dev-api.clickzetta.com DINGTALK
 *
 * 期望结果：终端出二维码，手机扫码授权后打印 token 和 userinfo。
 */

import { spawn } from "node:child_process"

import * as client from "openid-client"
import QRCode from "qrcode"

const ISSUER = process.argv[2] ?? "https://uat-api.clickzetta.com"
// 第二个参数：四个第三方平台之一，或 PASSWORD（走 auth_method 而非 provider）。
const PROVIDER = (process.argv[3] ?? "FEISHU").toUpperCase()
const CLIENT_ID = "official-cli"
// 和 CLI 一致，刻意不带 openid：我们不消费 id_token，身份从 userinfo 拿。
const SCOPE = "profile offline_access"
const OPEN_BROWSER = process.env.OAUTH_OPEN_BROWSER === "1"

if (!["ALIPAY", "WECHAT", "FEISHU", "DINGTALK", "PASSWORD"].includes(PROVIDER)) {
  throw new Error(`不支持的 provider: ${PROVIDER}，可选值为 ALIPAY、WECHAT、FEISHU、DINGTALK、PASSWORD`)
}

// PASSWORD 不是一个 provider 值，它走另一个参数。两种形式互斥：网关只认合法的那
// 一个，另一个即使乱填也被静默忽略。
const AUTH_PARAMS = PROVIDER === "PASSWORD" ? { auth_method: "password" } : { provider: PROVIDER }

function openBrowser(url: string) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open"
  spawn(command, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref()
}

type DeviceStatusResponse = {
  deviceStatus?: string
  result?: {
    userSelectTicket?: string
    users?: Array<{
      accountId?: number
      accountDisplayName?: string
      userId?: number
      displayName?: string
    }>
  }
}

/** 私有设备接口是 /oauth2/* 的兄弟路由，从 token endpoint 推导，不硬编码网关前缀。 */
function privateDeviceEndpoint(tokenEndpoint: string, path: string) {
  const endpoint = new URL(tokenEndpoint)
  const oauthTokenPath = "/oauth2/token"
  if (!endpoint.pathname.endsWith(oauthTokenPath)) {
    throw new Error(`无法从 token endpoint 推导设备状态接口: ${tokenEndpoint}`)
  }
  endpoint.pathname = `${endpoint.pathname.slice(0, -oauthTokenPath.length)}${path}`
  endpoint.search = ""
  return endpoint
}

async function postJson<T>(url: URL, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  // 先收窄成对象再读字段：`null` 是合法 JSON，解析成功后 `payload.message` 会直接
  // 抛 TypeError，把一次可诊断的接口失败变成一句看不懂的类型错误。裸字符串/数组
  // 同理，没有 envelope 可言。
  const parsed: unknown = await response.json().catch(() => undefined)
  const payload =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as { code?: unknown; data?: T; message?: string })
      : undefined
  if (!response.ok) {
    throw new Error(`设备接口失败: HTTP ${response.status} ${payload?.message ?? JSON.stringify(parsed)}`)
  }
  if (!payload) {
    throw new Error(`设备接口返回了非对象响应: HTTP ${response.status} ${JSON.stringify(parsed)}`)
  }
  // 私有路由用 HTTP 200 + 非零 code 表示"请求被拒绝"，只看 HTTP 状态会把它读成
  // data 缺失，进而错报成"未识别的设备状态"。0/200 两种写法、数字和字符串都算成
  // 功，与 SDK 里其它 envelope 判断一致；code 缺失则按裸响应放过。
  const code = payload.code
  if (code !== undefined && code !== null && code !== 0 && code !== "0" && code !== 200 && code !== "200") {
    throw new Error(`设备接口被拒绝: code=${String(code)} ${payload.message ?? ""}`)
  }
  return (payload.data ?? payload) as T
}

// 网关 ThirdPartyDeviceStatus 里的等待态和终态。权威版本在
// src/commands/device-account-select.ts（WAITING_STATES / SETTLED_STATES），这里刻
// 意保留一份副本：脚本要证明的是"除这一段私有逻辑外标准客户端行为一致"，所以它自
// 己写全，不从 src/ import。代价是会漂移 —— 这份副本原先只认三个状态，把网关正在
// 承接绑定或 MFA 的会话当成失败中止掉了。改了那边就顺手改这里。
const WAITING_STATES = new Set([
  "AUTHORIZATION_PENDING",
  "AUTHORIZED",
  "NEED_MFA",
  "NEED_BIND",
  "NEED_REGISTER",
  "OAUTH_TOKEN_PROCESSING",
])
const SETTLED_STATES = new Set(["SUCCESS", "OAUTH_TOKEN_CONSUMED"])

async function resolveMultipleAccountSelection(tokenEndpoint: string, deviceCode: string, intervalSeconds: number) {
  const statusEndpoint = privateDeviceEndpoint(tokenEndpoint, "/api/v1/third-party/device/token")
  const selectEndpoint = privateDeviceEndpoint(tokenEndpoint, "/api/v1/third-party/device/select-user")

  while (true) {
    const status = await postJson<DeviceStatusResponse>(statusEndpoint, { deviceCode })
    const state = status.deviceStatus ?? "UNKNOWN"
    if (WAITING_STATES.has(state)) {
      await Bun.sleep(intervalSeconds * 1000)
      continue
    }
    if (SETTLED_STATES.has(state)) return
    if (state !== "NEED_SELECT_USER") {
      throw new Error(`设备授权进入 ${state} 状态`)
    }

    const ticket = status.result?.userSelectTicket
    const users = status.result?.users ?? []
    if (!ticket || users.length === 0) {
      throw new Error("服务端返回 NEED_SELECT_USER，但没有可选择的平台账号")
    }

    console.log("检测到该第三方账号绑定了多个平台账号，请选择登录账号：")
    users.forEach((user, index) => {
      console.log(
        `  [${index + 1}] ${user.accountDisplayName ?? "未知账号"}` +
          ` / ${user.displayName ?? "未知用户"}` +
          ` (accountId=${user.accountId}, userId=${user.userId})`,
      )
    })
    const answer = prompt(`请输入序号 [1-${users.length}]`)
    const index = Number(answer) - 1
    if (!Number.isInteger(index) || index < 0 || index >= users.length) {
      throw new Error("平台账号选择无效")
    }
    const selected = users[index]
    if (!selected || selected.accountId == null || selected.userId == null) {
      throw new Error("候选平台账号缺少 accountId 或 userId")
    }
    await postJson(selectEndpoint, {
      deviceCode,
      userSelectTicket: ticket,
      accountId: selected.accountId,
      userId: selected.userId,
    })
    return
  }
}

async function main() {
  // ── 步骤 0 · RFC 8414 discovery ──────────────────────────────────────────
  const issuerUrl = new URL(ISSUER)
  const isLoopbackHttp =
    issuerUrl.protocol === "http:" && (issuerUrl.hostname === "127.0.0.1" || issuerUrl.hostname === "localhost")
  const config = await client.discovery(issuerUrl, CLIENT_ID, undefined, client.None(), {
    algorithm: "oauth2",
    execute: isLoopbackHttp ? [client.allowInsecureRequests] : undefined,
  })

  const metadata = config.serverMetadata()
  if (!metadata.device_authorization_endpoint) {
    throw new Error(
      `Authorization Server Metadata 缺少 device_authorization_endpoint —— ${metadata.issuer} 未部署 device flow`,
    )
  }
  if (!metadata.token_endpoint) {
    throw new Error("Authorization Server Metadata 缺少 token_endpoint")
  }

  console.log("[0] discovery ok")
  console.log("    issuer:                       ", metadata.issuer)
  console.log("    device_authorization_endpoint:", metadata.device_authorization_endpoint)
  console.log("    token_endpoint:               ", metadata.token_endpoint)
  console.log("    userinfo_endpoint:            ", metadata.userinfo_endpoint)

  // ── 步骤 1 · 申请设备授权 ────────────────────────────────────────────────
  const authorization = await client.initiateDeviceAuthorization(config, { scope: SCOPE, ...AUTH_PARAMS })
  const verificationUrl = authorization.verification_uri_complete ?? authorization.verification_uri

  console.log("[1] device authorization created")
  console.log("    user_code:       ", authorization.user_code)
  console.log("    verification_uri:", authorization.verification_uri)
  console.log("    expires_in:      ", authorization.expires_in)
  console.log("    interval:        ", authorization.interval ?? 5)
  const step2 = PROVIDER === "PASSWORD"
    ? "请打开下面的页面，用 ClickZetta 账号密码登录："
    : "请使用手机扫码登录，或手动打开："
  console.log(`[2] ${step2}\n    ${verificationUrl}\n`)
  console.log(await QRCode.toString(verificationUrl, { type: "terminal", small: true, errorCorrectionLevel: "M" }))
  if (OPEN_BROWSER) openBrowser(verificationUrl)

  // ── 步骤 2 · 账号选定 + 标准轮询 ─────────────────────────────────────────
  // 多平台绑定时标准 token endpoint 只会返回 authorization_pending，所以先用私有
  // 状态接口把账号选定，再交回 openid-client 收 token。
  console.log("[3] waiting for user authorization ...")
  await resolveMultipleAccountSelection(
    metadata.token_endpoint,
    authorization.device_code,
    authorization.interval ?? 5,
  )
  // interval 压到 1：pollDeviceAuthorizationGrant 会在第一次请求前先睡一个
  // interval，而此时授权已经落定，没必要再等服务端给的 5 秒。CLI 里同理。
  const tokens = await client.pollDeviceAuthorizationGrant(config, { ...authorization, interval: 1 })

  console.log("[4] token ok:", {
    token_type: tokens.token_type,
    expires_in: tokens.expires_in,
    scope: tokens.scope,
    has_access_token: Boolean(tokens.access_token),
    has_refresh_token: Boolean(tokens.refresh_token),
  })

  // ── 步骤 3 · 读取标准 UserInfo ───────────────────────────────────────────
  if (!metadata.userinfo_endpoint) {
    console.log("[5] metadata 未声明 userinfo_endpoint，跳过 userinfo")
    return
  }

  const response = await client.fetchProtectedResource(
    config,
    tokens.access_token,
    new URL(metadata.userinfo_endpoint),
    "GET",
  )
  if (!response.ok) {
    throw new Error(`userinfo 请求失败: HTTP ${response.status} ${await response.text()}`)
  }
  // 只打印白名单字段：userinfo 里还有 apiKey 等凭据（CLI 用它配置 LLM），
  // 和上面的 token 一样不能出现在终端、日志或录屏里。其余字段只列出名字。
  const userinfo = (await response.json()) as Record<string, unknown>
  const shown = ["sub", "userId", "accountName", "account_id", "instanceName", "workspaceName"]
  console.log("[5] userinfo:", {
    ...Object.fromEntries(shown.filter((key) => key in userinfo).map((key) => [key, userinfo[key]])),
    has_api_key: Boolean(userinfo.apiKey),
    other_fields: Object.keys(userinfo).filter((key) => !shown.includes(key)),
  })
}

main().catch((error: unknown) => {
  if (error instanceof client.ResponseBodyError) {
    console.error(`OAuth 错误: ${error.error}: ${error.error_description ?? error.message}`)
  } else if (error instanceof Error) {
    console.error(`错误: ${error.message}`)
  } else {
    console.error("错误:", error)
  }
  process.exitCode = 1
})
