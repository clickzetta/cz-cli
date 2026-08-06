import { afterAll, describe, expect, test } from "bun:test"
import { generateKeyPairSync } from "node:crypto"
import { createServer } from "node:http"
import { accountLoginUrlForService, loginByAccountSite, parseAccountConsoleMeta, serviceEnvFromApiHost } from "../src/commands/account-login"

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

describe("region vs environment host labels", () => {
  // A host label that looks like a prefix is either a deployment ENVIRONMENT
  // (dev/sit/uat) or a cloud REGION (cn-*/ap-*/us-*/eu-*). Environments carry
  // into derived hostnames; regions must not, because the derived sites are
  // global. Getting this wrong produced NXDOMAIN links in the billing dialog.
  test("region labels are not treated as environments", () => {
    for (const host of [
      "cn-shanghai-alicloud.api.clickzetta.com",
      "cn-beijing-alicloud.api.clickzetta.com",
      "ap-southeast-1-aws.api.singdata.com",
      "ap-shanghai-tencentcloud.api.clickzetta.com",
      "eu-central-1-aws.api.clickzetta.com",
      "us-east-1-aws.api.clickzetta.com",
    ]) {
      expect(serviceEnvFromApiHost(host)).toBe("")
    }
  })

  test("real environment labels still resolve", () => {
    expect(serviceEnvFromApiHost("uat-api.clickzetta.com")).toBe("uat")
    expect(serviceEnvFromApiHost("dev-api.clickzetta.com")).toBe("dev")
    expect(serviceEnvFromApiHost("sit-api.clickzetta.com")).toBe("sit")
    expect(serviceEnvFromApiHost("api.clickzetta.com")).toBe("")
  })
})

describe("account login", () => {
  test("builds account login urls for api and account hosts", () => {
    // A region segment is NOT an environment: accounts sites are global, so
    // cn-shanghai-alicloud must not be carried across. Verified against
    // production — acct.accounts.clickzetta.com resolves, while
    // acct.cn-shanghai-alicloud-accounts.clickzetta.com is NXDOMAIN, which is
    // what this test used to require.
    expect(accountLoginUrlForService("cn-shanghai-alicloud.api.clickzetta.com", "acct")).toBe(
      "https://acct.accounts.clickzetta.com",
    )
    expect(accountLoginUrlForService("cn-beijing-alicloud.api.clickzetta.com", "acct")).toBe(
      "https://acct.accounts.clickzetta.com",
    )
    expect(accountLoginUrlForService("ap-southeast-1-aws.api.singdata.com", "acct")).toBe(
      "https://acct.accounts.singdata.com",
    )
    // Real environment prefixes still carry over — those hosts do exist.
    expect(accountLoginUrlForService("dev-accounts.clickzetta.com", "acct")).toBe(
      "https://acct.dev-accounts.clickzetta.com",
    )
    expect(accountLoginUrlForService("uat-api.clickzetta.com", "acct")).toBe(
      "https://acct.uat-accounts.clickzetta.com",
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
