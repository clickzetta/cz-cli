import { afterAll, describe, expect, test } from "bun:test"
import { generateKeyPairSync } from "node:crypto"
import { createServer } from "node:http"
import { accountLoginUrlForService, loginByAccountSite, parseAccountConsoleMeta } from "../src/commands/account-login"

const { publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 1024,
  privateKeyEncoding: { format: "pem", type: "pkcs1" },
  publicKeyEncoding: { format: "der", type: "spki" },
})

let lastSubmittedPassword = ""

const server = createServer(async (request, response) => {
  if (request.url?.startsWith("/one-combo-api/configCenter/script/getApolloConfig")) {
    response.writeHead(200, { "content-type": "application/javascript" })
    response.end(
      `(function (global) {
        global.__clickzettaFeConsoleMeta__ = ${JSON.stringify({
          apiGateway: "https://dev-api.clickzetta.com",
          encryptKey: publicKey.toString("base64"),
        })}
      })(window)`,
    )
    return
  }
  if (request.url === "/login" && request.method === "POST") {
    const body = await new Promise<string>((resolve) => {
      let buffer = ""
      request.setEncoding("utf8")
      request.on("data", (chunk) => { buffer += chunk })
      request.on("end", () => resolve(buffer))
    })
    const payload = JSON.parse(body) as Record<string, string>
    lastSubmittedPassword = payload.password
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify({
      code: 0,
      data: {
        accountId: 2,
        token: "test-token",
        userId: 1,
      },
    }))
    return
  }
  response.writeHead(404)
  response.end("not found")
})

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))

afterAll(() => {
  server.close()
})

describe("account login", () => {
  test("builds account login urls for api and account hosts", () => {
    expect(accountLoginUrlForService("cn-shanghai-alicloud.api.clickzetta.com", "acct")).toBe(
      "https://acct.cn-shanghai-alicloud-accounts.clickzetta.com",
    )
    expect(accountLoginUrlForService("dev-accounts.clickzetta.com", "acct")).toBe(
      "https://acct.dev-accounts.clickzetta.com",
    )
  })

  test("parses console meta script", () => {
    expect(parseAccountConsoleMeta(`global.__clickzettaFeConsoleMeta__ = {"apiGateway":"https://dev-api.clickzetta.com","encryptKey":"abc"}`)).toEqual({
      apiGateway: "https://dev-api.clickzetta.com",
      encryptKey: "abc",
    })
  })

  test("encrypts password before posting to account login", async () => {
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("server address unavailable")
    const baseUrl = `http://127.0.0.1:${address.port}`
    const login = await loginByAccountSite("acct", "user", "secret-123", baseUrl, 20_000, baseUrl)
    expect(lastSubmittedPassword).not.toBe("secret-123")
    expect(lastSubmittedPassword).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(login.token).toBe("test-token")
    expect(login.serviceHost).toBe("dev-api.clickzetta.com")
    expect(login.serviceUrl).toBe("https://dev-api.clickzetta.com")
  })
})
