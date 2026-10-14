import { afterEach, expect, test } from "bun:test"
import { clearTokenCache, getToken } from "../src/auth/token"
import { DEFAULT_CONNECTION } from "../src/types"

afterEach(clearTokenCache)

test("same-named instances on different services cannot share cached or in-flight logins", async () => {
  const logins = [0, 0]
  const servers = logins.map((_, index) => Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      logins[index]++
      return Response.json({ code: 0, data: { token: `service-${index}`, instanceId: index + 1, userId: 1, expireTime: 600_000 } })
    },
  }))
  const configs = servers.map((server) => ({
    ...DEFAULT_CONNECTION, service: `127.0.0.1:${server.port}`, protocol: "http", instance: "same", username: "user", password: "password",
  }))
  try {
    expect((await Promise.all(configs.map(getToken))).map((token) => token.token)).toEqual(["service-0", "service-1"])
    expect((await Promise.all(configs.map(getToken))).map((token) => token.instanceId)).toEqual([1, 2])
    expect(logins).toEqual([1, 1])
  } finally {
    servers.forEach((server) => server.stop(true))
  }
})

test("changing a password cannot reuse the previous credential's token", async () => {
  const passwords: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = await request.json() as { password: string }
      passwords.push(body.password)
      return Response.json({ code: 0, data: { token: `login-${passwords.length}`, instanceId: 1, userId: 1, expireTime: 600_000 } })
    },
  })
  const config = { ...DEFAULT_CONNECTION, service: `127.0.0.1:${server.port}`, protocol: "http", instance: "same", username: "user", password: "old" }
  try {
    expect((await getToken(config)).token).toBe("login-1")
    expect((await getToken({ ...config, password: "new" })).token).toBe("login-2")
    expect(passwords).toEqual(["old", "new"])
  } finally {
    server.stop(true)
  }
})
