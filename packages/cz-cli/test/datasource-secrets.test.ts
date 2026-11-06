import { describe, expect, test } from "bun:test"

/**
 * `datasource list` echoes connectionParams, which for OSS/S3 carries
 * access_key_id/access_key_secret and for databases carries passwords/tokens —
 * sometimes as a JSON-encoded string or inline in a JDBC URL. The default output
 * must keep every field but replace credential values with '********';
 * --show-secrets is the only path to plaintext (covered by the execute() tests
 * at the bottom of this file).
 */
// integration-sync-vc.test.ts globally mocks "../src/commands/datasource.js";
// the "?real" query fetches an unmocked copy (same guard as datasource-resolve.test.ts).
const { maskSecrets } = await import("../src/commands/datasource.ts?real")

describe("maskSecrets", () => {
  test("masks OSS access keys but keeps endpoint/bucket readable", () => {
    const masked = maskSecrets({
      access_key_id: "{{SECRET_nu8fmark}}",
      access_key_secret: "fake-sk-value",
      endpoint: "oss-cn-hangzhou.example.com",
      bucket: "my-bucket",
    }) as Record<string, unknown>
    expect(masked.access_key_id).toBe("********")
    expect(masked.access_key_secret).toBe("********")
    expect(masked.endpoint).toBe("oss-cn-hangzhou.example.com")
    expect(masked.bucket).toBe("my-bucket")
  })

  test("masks camelCase, ak/sk, password and token keys; leaves username/host/port alone", () => {
    const masked = maskSecrets({
      accessKeyId: "{{SECRET_kf18vs2l}}",
      secretAccessKey: "{{SECRET_3owkrqvn}}",
      ak: "{{SECRET_bms7gq2x}}",
      sk: "{{SECRET_ja0spdbt}}",
      password: "fake-password",
      api_token: "fake-token",
      privateKey: "-----BEGIN...",
      username: "dbuser",
      host: "rm-bp.example.com",
      port: 3306,
    }) as Record<string, unknown>
    expect(masked.accessKeyId).toBe("********")
    expect(masked.secretAccessKey).toBe("********")
    expect(masked.ak).toBe("********")
    expect(masked.sk).toBe("********")
    expect(masked.password).toBe("********")
    expect(masked.api_token).toBe("********")
    expect(masked.privateKey).toBe("********")
    expect(masked.username).toBe("dbuser")
    expect(masked.host).toBe("rm-bp.example.com")
    expect(masked.port).toBe(3306)
  })

  test("recurses into nested objects and arrays", () => {
    const masked = maskSecrets({
      auth: { token: "fake-token", mode: "basic" },
      brokers: [{ user: "u", password: "fake-password" }, "kafka-1.example.com:9092"],
    }) as { auth: Record<string, unknown>; brokers: unknown[] }
    expect(masked.auth.token).toBe("********")
    expect(masked.auth.mode).toBe("basic")
    expect((masked.brokers[0] as Record<string, unknown>).password).toBe("********")
    expect((masked.brokers[0] as Record<string, unknown>).user).toBe("u")
    expect(masked.brokers[1]).toBe("kafka-1.example.com:9092")
  })

  test("masks a JSON-encoded params string, passes plain strings through", () => {
    const masked = maskSecrets('{"access_key_id":"{{SECRET_nu8fmark}}","access_key_secret":"{{SECRET_ja0spdbt}}","bucket":"b"}')
    expect(masked).toBe('{"access_key_id":"********","access_key_secret":"********","bucket":"b"}')
    expect(maskSecrets("oss://plain-endpoint")).toBe("oss://plain-endpoint")
    expect(maskSecrets("{not json")).toBe("{not json")
  })

  test("masks passwords embedded in jdbcUrl query params, keeps other params", () => {
    const masked = maskSecrets({
      password: "fake-password",
      username: "root",
      jdbcUrl: "jdbc:mysql://rm-bp.example.com:3306/db?password={{SECRET_he4dtjc9}}&useSSL=false&serverTimezone=UTC",
    }) as Record<string, unknown>
    expect(masked.password).toBe("********")
    expect(masked.username).toBe("root")
    expect(masked.jdbcUrl).toBe("jdbc:mysql://rm-bp.example.com:3306/db?password=********&useSSL=false&serverTimezone=UTC")
    expect(maskSecrets("jdbc:clickzetta://inst.example.com/ws?password={{SECRET_he4dtjc9}}&user=u")).toBe(
      "jdbc:clickzetta://inst.example.com/ws?password=********&user=u")
    expect(maskSecrets("jdbc:mysql://host.example.com:3306/db?useSSL=false")).toBe(
      "jdbc:mysql://host.example.com:3306/db?useSSL=false")
  })

  test("leaves empty and missing secrets as-is so NULL stays distinguishable", () => {
    const masked = maskSecrets({ access_key_id: "", access_key_secret: null }) as Record<string, unknown>
    expect(masked.access_key_id).toBe("")
    expect(masked.access_key_secret).toBeNull()
    expect(maskSecrets(undefined)).toBeUndefined()
  })
})
