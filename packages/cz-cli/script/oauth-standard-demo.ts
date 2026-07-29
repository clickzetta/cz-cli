/**
 * 标准 OAuth 2.0 + PKCE 浏览器登录流程验证脚本。
 *
 * 用官方库 openid-client 驱动，不含任何 ClickZetta 私有逻辑，用来验证服务端是否
 * 满足标准 OAuth。任何标准客户端（Java/Go/Python 的 OAuth 库）的行为都和它一致。
 *
 * 依赖：只有 bun 和 openid-client。可以拷到任意空目录独立运行。
 *
 *   bun init -y
 *   bun add openid-client
 *   bun oauth-standard-demo.ts                                  # 默认 dev
 *   bun oauth-standard-demo.ts https://uat-api.clickzetta.com    # 指定 issuer
 *
 * 全流程只需要一个输入：issuer。其余地址（authorize / token / userinfo）都从
 * discovery 文档里读，客户端不需要知道 accounts 域名的存在。
 *
 * 期望结果：浏览器打开登录页，登录后终端打印 token 和 userinfo。
 */

import { spawn } from "node:child_process"
import { createServer } from "node:http"
import * as client from "openid-client"

const ISSUER = process.argv[2] ?? "https://dev-api.clickzetta.com"
const CLIENT_ID = "official-cli"
const SCOPE = "profile offline_access"

/**
 * 起一个 loopback 监听，返回它的地址和一个等待回调 URL 的 promise。
 * 这部分所有 OAuth 库都不管：CLI 要 open URL，Web 应用要 302，桌面应用用 WebView。
 */
function startCallbackServer() {
  let resolve: (url: URL) => void
  const received = new Promise<URL>((r) => (resolve = r))

  // 必须带上实际端口。authorizationCodeGrant 会从这个 URL 推导出 token 请求里的
  // redirect_uri，而 RFC 6749 §4.1.3 要求它和 authorize 请求里的完全一致 —— 少了
  // 端口就会被服务端判为不匹配，返回 invalid_grant。
  let callbackOrigin = "http://127.0.0.1"

  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("登录完成，可以关闭此页")
    resolve(new URL(req.url!, callbackOrigin))
  })
  server.listen(0, "127.0.0.1")

  return new Promise<{ redirectUri: string; received: Promise<URL>; close: () => void }>((ready) => {
    server.once("listening", () => {
      const { port } = server.address() as { port: number }
      callbackOrigin = `http://127.0.0.1:${port}`
      ready({
        redirectUri: `${callbackOrigin}/callback`,
        received,
        close: () => server.close(),
      })
    })
  })
}

function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open"
  spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref()
}

// ── 步骤 0 · discovery ───────────────────────────────────────────────────────
// 拉元数据文档、校验 issuer（RFC 8414 §3.3）、解析出所有端点。
// 这是整个流程唯一一次说出主机名的地方。
//
// 第 5 个参数指定走 RFC 8414 的 /.well-known/oauth-authorization-server。
// 库默认探 OIDC 的 /.well-known/openid-configuration，dev 上是 404，所以要显式指定。
// 服务端把同一份文档也挂到 openid-configuration 后，这个参数就可以去掉。
const config = await client.discovery(new URL(ISSUER), CLIENT_ID, undefined, undefined, {
  algorithm: "oauth2",
})

const meta = config.serverMetadata()
console.log("[0] discovery ok")
console.log("    authorization_endpoint:", meta.authorization_endpoint)
console.log("    token_endpoint:        ", meta.token_endpoint)
console.log("    userinfo_endpoint:     ", meta.userinfo_endpoint)

// ── 步骤 1 · 本地状态 ────────────────────────────────────────────────────────
// code_verifier 是随机串，只留在本进程内存里，从不写进 URL。
// code_challenge = base64url(sha256(verifier))，公开，写进 authorize URL。
// 先绑端口，才知道 redirect_uri 是什么，才能写进下一步的 URL。
const codeVerifier = client.randomPKCECodeVerifier()
const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier)
const state = client.randomState()
const cb = await startCallbackServer()
console.log(`[1] pkce + loopback ready, redirect_uri=${cb.redirectUri}`)

// ── 步骤 2 · 库拼 authorize URL ──────────────────────────────────────────────
// 地址取自 config.authorization_endpoint，参数是标准扁平形式。
// 库在这里就收工了 —— 它没有任何参数能让你换成别的域名或别的编码格式。
const authorizeUrl = client.buildAuthorizationUrl(config, {
  redirect_uri: cb.redirectUri,
  scope: SCOPE,
  code_challenge: codeChallenge,
  code_challenge_method: "S256",
  state,
})

console.log(`[2] open browser:\n    ${authorizeUrl.href}`)
openBrowser(authorizeUrl.href)

// ── 步骤 3~6 · 全部在浏览器和服务端之间，客户端只是在等 ──────────────────────
//   ③ authorize 无会话 → 302 到 accounts 登录页，把原 authorize URL 打包带上
//   ④ 用户登录，accounts 种下会话 cookie
//   ⑤ accounts → 302 回原 authorize URL（这次浏览器带着 cookie）
//   ⑥ authorize 认出会话 → 存下 code_challenge、发 code
//                        → 302 到 redirect_uri?code=...&state=...
//
// 关键约束：发 code 的组件必须和步骤 8 校验 code_verifier 的组件是同一个，
// 否则 challenge 和 verifier 落在两处存储里，步骤 8 必然 invalid_grant。
console.log("[3] waiting for callback on loopback ...")

// ── 步骤 7~8 · 校验 state、取 code、换 token ─────────────────────────────────
const callbackUrl = await cb.received
cb.close()
console.log(`[7] callback received: ${callbackUrl.pathname}?${callbackUrl.searchParams.toString().slice(0, 60)}...`)

const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
  pkceCodeVerifier: codeVerifier,
  expectedState: state,
})
console.log("[8] token ok:", {
  token_type: tokens.token_type,
  expires_in: tokens.expires_in,
  has_refresh_token: Boolean(tokens.refresh_token),
})

// ── 步骤 9 · 取身份 ─────────────────────────────────────────────────────────
const res = await client.fetchProtectedResource(
  config,
  tokens.access_token,
  new URL(meta.userinfo_endpoint!),
  "GET",
)
console.log("[9] userinfo:", await res.json())
