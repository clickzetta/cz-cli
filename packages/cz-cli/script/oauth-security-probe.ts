/**
 * OAuth 黑盒安全探测：站在第三方攻击者角度，逐个假设"我截获了流程中的某一步"，
 * 看服务端能否挡住。
 *
 *   bun script/oauth-security-probe.ts                                  # 只跑无害探测
 *   bun script/oauth-security-probe.ts --code <code> --port <port>      # 带真实 code 的探测
 *   bun script/oauth-security-probe.ts https://uat-api.clickzetta.com   # 指定环境
 *
 * 所有请求只发往目标服务端自身，用 redirect:"manual" 只读响应头，不跟随跳转，
 * 不会有任何数据流向探测中出现的外部域名。
 */

import * as client from "openid-client"

const args = process.argv.slice(2)
const ISSUER = args.find((a) => a.startsWith("http")) ?? "https://dev-api.clickzetta.com"
const REAL_CODE = args[args.indexOf("--code") + 1]?.startsWith("--") ? undefined : args[args.indexOf("--code") + 1]
const REAL_PORT = args[args.indexOf("--port") + 1]
const REAL_VERIFIER = args[args.indexOf("--verifier") + 1]
const CLIENT_ID = "official-cli"

const config = await client.discovery(new URL(ISSUER), CLIENT_ID, undefined, undefined, { algorithm: "oauth2" })
const meta = config.serverMetadata()
const AUTHORIZE = meta.authorization_endpoint!
const TOKEN = meta.token_endpoint!

let pass = 0
let fail = 0
let manual = 0

function report(verdict: "PASS" | "FAIL" | "CHECK", title: string, detail: string) {
  const mark = verdict === "PASS" ? "✓ 挡住" : verdict === "FAIL" ? "✗ 未挡住" : "? 需人工判断"
  if (verdict === "PASS") pass++
  else if (verdict === "FAIL") fail++
  else manual++
  console.log(`\n${mark}  ${title}`)
  console.log(`        ${detail}`)
}

/** 构造一个 authorize 请求，只读响应头。 */
async function authorize(params: Record<string, string>) {
  const u = new URL(AUTHORIZE)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  const r = await fetch(u, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0" } })
  return { status: r.status, location: r.headers.get("location"), body: (await r.text()).slice(0, 200) }
}

/** 构造一个 token 请求。 */
async function token(body: Record<string, string>) {
  const r = await fetch(TOKEN, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  })
  return { status: r.status, body: (await r.text()).slice(0, 250) }
}

const BASE = {
  response_type: "code",
  client_id: CLIENT_ID,
  scope: "profile offline_access",
  code_challenge: "A7g2IC9GGnWBAp2esNCmtJlXoZunylQeK88FDVqOU8c",
  code_challenge_method: "S256",
  state: "probe-state-abc123",
}
const LOOPBACK = "http://127.0.0.1:51159/callback"

console.log(`目标: ${ISSUER}`)
console.log(`authorize: ${AUTHORIZE}`)
console.log(`token:     ${TOKEN}`)
console.log("\n" + "=".repeat(78))
console.log("场景 A · 攻击者伪造 authorize 链接发给受害者（钓鱼）")
console.log("=".repeat(78))

// A1 — 把 code 骗到攻击者的服务器
{
  const r = await authorize({ ...BASE, redirect_uri: "https://evil.example.com/steal" })
  const jumped = r.status >= 300 && r.status < 400 && (r.location ?? "").includes("accounts")
  report(
    jumped ? "FAIL" : "PASS",
    "A1 外部域名 redirect_uri（RFC 6749 §4.1.2.1 MUST NOT redirect）",
    jumped
      ? `服务端跳到了登录页 → 受害者登录后 code 会被送到 evil.example.com。status=${r.status}`
      : `status=${r.status}, location=${(r.location ?? "(none)").slice(0, 90)}`,
  )
}

// A2 — 同域下的路径劫持
{
  const r = await authorize({ ...BASE, redirect_uri: "https://dev-api.clickzetta.com/attacker-controlled" })
  const jumped = r.status >= 300 && r.status < 400 && (r.location ?? "").includes("accounts")
  report(
    jumped ? "FAIL" : "PASS",
    "A2 同域但未注册的 redirect_uri",
    `status=${r.status}, location=${(r.location ?? "(none)").slice(0, 90)}`,
  )
}

// A3 — 非 loopback 的 http 地址
{
  const r = await authorize({ ...BASE, redirect_uri: "http://attacker.example.com/cb" })
  const jumped = r.status >= 300 && r.status < 400 && (r.location ?? "").includes("accounts")
  report(jumped ? "FAIL" : "PASS", "A3 非 loopback 的明文 http redirect_uri", `status=${r.status}`)
}

// A4 — 用 localhost 别名绕过（RFC 8252 §8.3 不建议接受）
{
  const r = await authorize({ ...BASE, redirect_uri: "http://localhost.evil.example.com/cb" })
  const jumped = r.status >= 300 && r.status < 400 && (r.location ?? "").includes("accounts")
  report(
    jumped ? "FAIL" : "PASS",
    "A4 前缀伪装 localhost.evil.example.com",
    `status=${r.status}, location=${(r.location ?? "(none)").slice(0, 90)}`,
  )
}

console.log("\n" + "=".repeat(78))
console.log("场景 B · 攻击者降级 PKCE，让截获的 code 变得可用")
console.log("=".repeat(78))

// B1 — 完全不带 code_challenge
{
  const { code_challenge, code_challenge_method, ...noPkce } = BASE
  const r = await authorize({ ...noPkce, redirect_uri: LOOPBACK })
  const jumped = r.status >= 300 && r.status < 400
  report(
    jumped ? "CHECK" : "PASS",
    "B1 不带 code_challenge（PKCE 是否可绕过，RFC 7636 §4.4.1）",
    jumped
      ? `authorize 接受了无 PKCE 请求 status=${r.status}。需确认 token 端点是否也放行 —— 若放行，` +
        `截获 code 即可换 token，PKCE 形同虚设`
      : `status=${r.status}, body=${r.body.slice(0, 120)}`,
  )
}

// B2 — 降级到 plain
{
  const r = await authorize({
    ...BASE,
    code_challenge: "plain-challenge-value-not-hashed-at-all-1234",
    code_challenge_method: "plain",
    redirect_uri: LOOPBACK,
  })
  const jumped = r.status >= 300 && r.status < 400
  report(
    jumped ? "CHECK" : "PASS",
    "B2 降级 code_challenge_method=plain（discovery 只声明 S256）",
    jumped ? `authorize 接受了 plain status=${r.status}，需确认 token 端点行为` : `status=${r.status}`,
  )
}

// B3 — 声明 S256 但给一个非哈希值
{
  const r = await authorize({ ...BASE, code_challenge: "short", redirect_uri: LOOPBACK })
  report(
    r.status >= 300 && r.status < 400 ? "CHECK" : "PASS",
    "B3 code_challenge 长度非法（RFC 7636 要求 43~128 字符）",
    `status=${r.status}`,
  )
}

console.log("\n" + "=".repeat(78))
console.log("场景 C · 攻击者截获了 code（本机进程 / 日志 / 地址栏），尝试换 token")
console.log("=".repeat(78))

// C1 — 没有 verifier
{
  const r = await token({
    grant_type: "authorization_code",
    code: REAL_CODE ?? "intercepted-code-placeholder",
    redirect_uri: REAL_PORT ? `http://127.0.0.1:${REAL_PORT}/callback` : LOOPBACK,
    client_id: CLIENT_ID,
  })
  const got = r.body.includes("access_token")
  report(
    got ? "FAIL" : "PASS",
    "C1 只有 code、没有 code_verifier" + (REAL_CODE ? "（真实 code）" : "（占位 code，仅看错误类型）"),
    `status=${r.status}, ${r.body.slice(0, 160)}`,
  )
}

// C2 — 猜一个 verifier
{
  const r = await token({
    grant_type: "authorization_code",
    code: REAL_CODE ?? "intercepted-code-placeholder",
    code_verifier: "attacker-guessed-verifier-aaaaaaaaaaaaaaaaaaaaaaa",
    redirect_uri: REAL_PORT ? `http://127.0.0.1:${REAL_PORT}/callback` : LOOPBACK,
    client_id: CLIENT_ID,
  })
  const got = r.body.includes("access_token")
  report(
    got ? "FAIL" : "PASS",
    "C2 错误的 code_verifier（RFC 7636 §4.6 MUST invalid_grant）" + (REAL_CODE ? "（真实 code）" : "（占位 code）"),
    `status=${r.status}, ${r.body.slice(0, 160)}`,
  )
}

// C3 — 换一个 client_id
{
  const r = await token({
    grant_type: "authorization_code",
    code: REAL_CODE ?? "intercepted-code-placeholder",
    ...(REAL_VERIFIER ? { code_verifier: REAL_VERIFIER } : {}),
    redirect_uri: REAL_PORT ? `http://127.0.0.1:${REAL_PORT}/callback` : LOOPBACK,
    client_id: "attacker-client",
  })
  const got = r.body.includes("access_token")
  report(got ? "FAIL" : "PASS", "C3 用别的 client_id 换同一个 code", `status=${r.status}, ${r.body.slice(0, 160)}`)
}

// C4 — code 重放（需要真实 code + verifier，且必须在真登录已消费过之后）
if (REAL_CODE && REAL_VERIFIER && REAL_PORT) {
  const r = await token({
    grant_type: "authorization_code",
    code: REAL_CODE,
    code_verifier: REAL_VERIFIER,
    redirect_uri: `http://127.0.0.1:${REAL_PORT}/callback`,
    client_id: CLIENT_ID,
  })
  const got = r.body.includes("access_token")
  report(
    got ? "FAIL" : "PASS",
    "C4 code 重放（RFC 6749 §4.1.2 MUST NOT reuse）",
    got ? `同一个 code 换到了第二份 token！${r.body.slice(0, 120)}` : `status=${r.status}, ${r.body.slice(0, 160)}`,
  )
} else {
  console.log("\n-  C4 code 重放 — 跳过，需 --code + --verifier + --port（且 code 已被真实登录消费过一次）")
}

console.log("\n" + "=".repeat(78))
console.log("场景 D · 传输与协议层面")
console.log("=".repeat(78))

// D1 — token 端点是否接受明文 http
{
  try {
    const r = await fetch(TOKEN.replace("https://", "http://"), {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: "x", client_id: CLIENT_ID }),
    })
    const upgraded = r.status >= 300 && r.status < 400 && (r.headers.get("location") ?? "").startsWith("https://")
    report(
      upgraded || r.status === 400 || r.status >= 403 ? "PASS" : "CHECK",
      "D1 token 端点明文 http（RFC 6749 §3.2 MUST require TLS）",
      `status=${r.status}, location=${(r.headers.get("location") ?? "(none)").slice(0, 80)}`,
    )
  } catch (e) {
    report("PASS", "D1 token 端点明文 http", `连接被拒绝: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// D2 — state 是否原样透传（CSRF 防护的前提）
{
  const marker = "state-echo-marker-9f8e7d"
  const r = await authorize({ ...BASE, state: marker, redirect_uri: LOOPBACK })
  const echoed = (r.location ?? "").includes(marker)
  report(
    echoed ? "PASS" : "CHECK",
    "D2 state 原样透传（RFC 6749 §10.12）",
    echoed ? "登录跳转中带回了原始 state" : `未在跳转 URL 中看到 state。location=${(r.location ?? "(none)").slice(0, 90)}`,
  )
}

// D3 — accounts 侧能否被引导跳到外部域名（开放重定向）
{
  const r = await authorize({ ...BASE, redirect_uri: LOOPBACK })
  const loc = r.location ?? ""
  if (!loc) {
    report("CHECK", "D3 accounts 跳转参数的开放重定向面", "authorize 未返回跳转，无法检查")
  } else {
    const u = new URL(loc)
    const external = [...u.searchParams.entries()].filter(
      ([, v]) => v.startsWith("http") && !v.includes("clickzetta.com") && !v.includes("127.0.0.1"),
    )
    report(
      "CHECK",
      "D3 accounts 收到的跳转参数（需 accounts 侧自行校验域名）",
      `accounts host=${u.host}, 参数=[${[...u.searchParams.keys()].join(", ")}]` +
        (external.length ? `, 外部地址=${JSON.stringify(external)}` : ""),
    )
  }
}

console.log("\n" + "=".repeat(78))
console.log(`结果: ${pass} 项挡住, ${fail} 项未挡住, ${manual} 项需人工判断`)
console.log("=".repeat(78))
console.log(`
黑盒测试只能证明问题存在，不能证明不存在。以下必须看代码：
  - code_challenge 是否加密存储、是否写进日志（RFC 7636 §4.4 MUST NOT extractable）
  - code 的单次使用是否有竞态
  - refresh token 轮转策略、是否绑定 client
  - 会话 cookie 的 HttpOnly / Secure / SameSite
`)
