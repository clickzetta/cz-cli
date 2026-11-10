import { afterAll, describe, expect, test } from "bun:test"
import { generateKeyPairSync } from "node:crypto"
import { createServer } from "node:http"
import { accountLoginUrlForService, assertSafeAccountSite, isSafeAccountLabel, accountSiteForApiService, derivedAccountSiteForService, loginByAccountSite, parseApiService, parseAccountConsoleMeta, serviceEnvFromApiHost } from "../src/commands/account-login"

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

  test("derives the accounts host only for https ClickZetta-owned hosts", () => {
    expect(derivedAccountSiteForService("https://api.clickzetta.com", "acct")).toBe("https://acct.accounts.clickzetta.com")
    expect(derivedAccountSiteForService("https://cn-shanghai-alicloud.api.clickzetta.com", "acct")).toBe(
      "https://acct.accounts.clickzetta.com",
    )
    expect(derivedAccountSiteForService("https://api.singdata.com", "acct")).toBe("https://acct.accounts.singdata.com")
    expect(derivedAccountSiteForService("https://lakehouse.example.co.uk", "acct")).toBeNull()
    expect(derivedAccountSiteForService("https://api.corp.internal", "acct")).toBeNull()
    expect(derivedAccountSiteForService("http://api.clickzetta.com", "acct")).toBeNull()
    expect(derivedAccountSiteForService("https://clickzetta.com.evil.example", "acct")).toBeNull()
    expect(derivedAccountSiteForService("https://evilclickzetta.com", "acct")).toBeNull()
  })

  test("refuses to post the password when the console meta has no encryption key", async () => {
    let posts = 0
    const bare = createServer((request, response) => {
      if (request.url?.startsWith("/one-combo-api/configCenter/script/getApolloConfig")) {
        response.writeHead(200)
        response.end(`x.__clickzettaFeConsoleMeta__ = {"apiGateway":"","encryptKey":""}`)
        return
      }
      if (request.url === "/login") posts += 1
      response.writeHead(404)
      response.end("{}")
    })
    await new Promise<void>((resolve) => bare.listen(0, "127.0.0.1", () => resolve()))
    const address = bare.address()
    if (!address || typeof address === "string") throw new Error("server address unavailable")
    const baseUrl = `http://127.0.0.1:${address.port}`
    await expect(
      loginByAccountSite("acct", "user", "secret-123", baseUrl, 20_000, baseUrl, { requireEncryptKey: true }),
    ).rejects.toThrow("encryption key")
    expect(posts).toBe(0)
    bare.close()
  })

  test("refuses to post the password when the console meta request fails", async () => {
    let posts = 0
    const broken = createServer((request, response) => {
      if (request.url === "/login") posts += 1
      response.writeHead(502)
      response.end("bad gateway")
    })
    await new Promise<void>((resolve) => broken.listen(0, "127.0.0.1", () => resolve()))
    const address = broken.address()
    if (!address || typeof address === "string") throw new Error("server address unavailable")
    const baseUrl = `http://127.0.0.1:${address.port}`
    await expect(
      loginByAccountSite("acct", "user", "secret-123", baseUrl, 20_000, baseUrl, { requireEncryptKey: true }),
    ).rejects.toThrow()
    expect(posts).toBe(0)
    broken.close()
  })

  test("decides ClickZetta ownership from the parsed hostname only", () => {
    expect(derivedAccountSiteForService("API.ClickZetta.com:8443", "acct")).toBe("https://acct.accounts.clickzetta.com:8443")
    expect(derivedAccountSiteForService("https://API.ClickZetta.com:8443/api", "acct")).toBe(
      "https://acct.accounts.clickzetta.com:8443",
    )
    for (const bad of [
      "evil?x-api.clickzetta.com",
      "evil#x-api.clickzetta.com",
      "https://evil?x-api.clickzetta.com",
      "https://evil#x-api.clickzetta.com",
      "evil@x-api.clickzetta.com",
      "https://user:pw@api.clickzetta.com",
      "https://evil.example\\@api.clickzetta.com",
      "evil.example\\x-api.clickzetta.com",
      "evil x-api.clickzetta.com",
      "https://api.clickzetta.com.",
      "https://api.clickzetta.com?x=1",
      "https://api.clickzetta.com/#frag",
    ]) {
      expect(parseApiService(bad)).toBeNull()
      expect(derivedAccountSiteForService(bad, "acct")).toBeNull()
    }
  })

  test("never probes or posts to a host a malformed service string would resolve to", async () => {
    const requests: string[] = []
    const local = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`)
      response.writeHead(200)
      response.end(`x.__clickzettaFeConsoleMeta__ = {"apiGateway":"","encryptKey":""}`)
    })
    await new Promise<void>((resolve) => local.listen(0, "127.0.0.1", () => resolve()))
    const address = local.address()
    if (!address || typeof address === "string") throw new Error("server address unavailable")
    const target = `127.0.0.1:${address.port}`
    for (const bad of [
      `http://${target}?x-api.clickzetta.com`,
      `${target}#x-api.clickzetta.com`,
      `http://user@${target}`,
      `http://${target}\\@api.clickzetta.com`,
    ]) {
      expect(await accountSiteForApiService(bad, "acct")).toBeNull()
    }
    expect(requests).toEqual([])
    // Control: the clean form of the same host is probed and accepted.
    expect(await accountSiteForApiService(`http://${target}`, "acct")).toEqual({ url: `http://${target}`, derived: false })
    expect(requests.length).toBe(1)
    local.close()
  })

  const hostileNames = ["evil.example/", "evil.example#", "evil.example?", "a/b", "a\\b", "a b", "", "a".repeat(64), "-a", "a-", "a.b", "a_b"]

  test("derives an accounts host only from a single DNS label account name", () => {
    for (const name of hostileNames) {
      expect(isSafeAccountLabel(name)).toBe(false)
      expect(derivedAccountSiteForService("https://api.clickzetta.com", name)).toBeNull()
    }
    expect(derivedAccountSiteForService("https://api.clickzetta.com", "ACCT")).toBe("https://ACCT.accounts.clickzetta.com")
    expect(isSafeAccountLabel("a".repeat(63))).toBe(true)
  })

  test("a hostile account name never reaches a local server", async () => {
    const requests: string[] = []
    const local = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`)
      response.writeHead(404)
      response.end()
    })
    await new Promise<void>((resolve) => local.listen(0, "127.0.0.1", () => resolve()))
    const address = local.address()
    if (!address || typeof address === "string") throw new Error("server address unavailable")
    const target = `127.0.0.1:${address.port}`
    for (const name of [`${target}/`, `${target}#`, `${target}?`]) {
      // https://<name>.accounts.clickzetta.com would resolve to the local server if built unchecked.
      expect(derivedAccountSiteForService("https://api.clickzetta.com", name)).toBeNull()
      const url = `https://${name}.accounts.clickzetta.com`
      await expect(
        loginByAccountSite(name, "user", "secret-123", "https://api.clickzetta.com", 2_000, url, { requireEncryptKey: true }),
      ).rejects.toThrow("refusing")
    }
    expect(requests).toEqual([])
    local.close()
  })

  test("the last-line defense rejects urls with a path, query, userinfo or foreign host", () => {
    const service = "https://api.clickzetta.com"
    expect(() => assertSafeAccountSite("https://acct.accounts.clickzetta.com", service, "acct")).not.toThrow()
    expect(() => assertSafeAccountSite("https://api.clickzetta.com", service, "acct")).not.toThrow()
    for (const bad of [
      "https://acct.accounts.clickzetta.com/x",
      "https://acct.accounts.clickzetta.com?x=1",
      "https://acct.accounts.clickzetta.com#x",
      "https://u@acct.accounts.clickzetta.com",
      "http://acct.accounts.clickzetta.com",
      "https://other.accounts.clickzetta.com",
      "https://acct.accounts.evil.example",
      "https://evil.example/.uat-accounts.clickzetta.com",
    ]) {
      expect(() => assertSafeAccountSite(bad, service, "acct")).toThrow("refusing")
    }
    expect(() => assertSafeAccountSite("http://127.0.0.1:1", "http://127.0.0.1:1", "acct")).not.toThrow()
    expect(() => assertSafeAccountSite("http://127.0.0.1:1/x", "http://127.0.0.1:1", "acct")).toThrow("refusing")
  })

  for (const stage of ["meta", "login"] as const) {
    test(`refuses a redirect from the ${stage} request on the fallback`, async () => {
      const second: string[] = []
      const other = createServer((request, response) => {
        second.push(`${request.method} ${request.url}`)
        response.writeHead(200)
        response.end(`x.__clickzettaFeConsoleMeta__ = {"apiGateway":"","encryptKey":"${publicKey.toString("base64")}"}`)
      })
      await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", () => resolve()))
      const otherAddress = other.address()
      if (!otherAddress || typeof otherAddress === "string") throw new Error("server address unavailable")
      const first = createServer((request, response) => {
        if (stage === "login" && request.url?.startsWith("/one-combo-api")) {
          response.writeHead(200)
          response.end(`x.__clickzettaFeConsoleMeta__ = {"apiGateway":"","encryptKey":"${publicKey.toString("base64")}"}`)
          return
        }
        response.writeHead(307, { location: `http://127.0.0.1:${otherAddress.port}${request.url}` })
        response.end()
      })
      await new Promise<void>((resolve) => first.listen(0, "127.0.0.1", () => resolve()))
      const address = first.address()
      if (!address || typeof address === "string") throw new Error("server address unavailable")
      const baseUrl = `http://127.0.0.1:${address.port}`
      await expect(
        loginByAccountSite("acct", "user", "secret-123", baseUrl, 5_000, baseUrl, { requireEncryptKey: true }),
      ).rejects.toThrow()
      expect(second).toEqual([])
      first.close()
      other.close()
    })
  }
})
