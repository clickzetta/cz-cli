import { describe, expect, test } from "bun:test"

/**
 * `datasource list` echoes connectionParams, which for OSS/S3 carries
 * access_key_id/access_key_secret and for databases carries passwords/tokens —
 * sometimes as a JSON-encoded string or inline in a JDBC URL. The default output
 * must keep every field but replace credential values with '********';
 * --show-secrets is the only path to plaintext (covered end-to-end in
 * datasource-list-secrets.test.ts).
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

  test("masks snake_case, kebab and camelCase ak/sk keys without hitting task/disk/skip", () => {
    const masked = maskSecrets({
      oss_ak: "{{SECRET_bms7gq2x}}",
      oss_sk: "{{SECRET_ja0spdbt}}",
      ak_id: "{{SECRET_kf18vs2l}}",
      "sk-secret": "{{SECRET_3owkrqvn}}",
      ossAk: "{{SECRET_bms7gq2x}}",
      ossSK: "{{SECRET_ja0spdbt}}",
      akId: "{{SECRET_kf18vs2l}}",
      AK: "{{SECRET_bms7gq2x}}",
      task: "sync",
      diskSize: 10,
      skipHeader: true,
    }) as Record<string, unknown>
    for (const key of ["oss_ak", "oss_sk", "ak_id", "sk-secret", "ossAk", "ossSK", "akId", "AK"])
      expect(masked[key]).toBe("********")
    expect(masked.task).toBe("sync")
    expect(masked.diskSize).toBe(10)
    expect(masked.skipHeader).toBe(true)
  })

  test("masks pwd keys and PWD connection-string params", () => {
    const masked = maskSecrets({ pwd: "fake-password", PWD: "fake-password", user: "u" }) as Record<string, unknown>
    expect(masked.pwd).toBe("********")
    expect(masked.PWD).toBe("********")
    expect(masked.user).toBe("u")
    expect(maskSecrets("jdbc:mysql://h.example.com/db?user=u&PWD={{SECRET_he4dtjc9}}")).toBe(
      "jdbc:mysql://h.example.com/db?user=u&PWD=********")
  })

  test("masks SQL Server ';'-separated JDBC properties", () => {
    expect(maskSecrets("jdbc:sqlserver://h.example.com:1433;databaseName=db;user=u;password={{SECRET_he4dtjc9}}")).toBe(
      "jdbc:sqlserver://h.example.com:1433;databaseName=db;user=u;password=********")
    expect(maskSecrets("jdbc:sqlserver://h.example.com:1433;password={{SECRET_he4dtjc9}};encrypt=true")).toBe(
      "jdbc:sqlserver://h.example.com:1433;password=********;encrypt=true")
  })

  test("masks passwords in URL userinfo but keeps the username", () => {
    expect(maskSecrets("postgresql://u:{{SECRET_he4dtjc9}}@h.example.com:5432/db")).toBe(
      "postgresql://u:********@h.example.com:5432/db")
    expect(maskSecrets("jdbc:postgresql://u:{{SECRET_he4dtjc9}}@h.example.com:5432/db?sslmode=require")).toBe(
      "jdbc:postgresql://u:********@h.example.com:5432/db?sslmode=require")
    expect(maskSecrets("mongodb://u@h.example.com:27017/db")).toBe("mongodb://u@h.example.com:27017/db")
    expect(maskSecrets("jdbc:mysql://h.example.com:3306/db")).toBe("jdbc:mysql://h.example.com:3306/db")
  })

  test("masks userinfo passwords containing @ or / by splitting on the last @", () => {
    expect(maskSecrets("mongodb://u:p@ss@h.example.com:27017/db")).toBe("mongodb://u:********@h.example.com:27017/db")
    expect(maskSecrets("mongodb://u:pa/ss@h.example.com:27017/db")).toBe("mongodb://u:********@h.example.com:27017/db")
    expect(maskSecrets("postgresql://u:p@ss@[::1]:5432/db")).toBe("postgresql://u:********@[::1]:5432/db")
  })

  test("masks userinfo passwords in multi-host and ;-property URIs", () => {
    expect(maskSecrets("mongodb://u:p@ss@h1:27017,h2:27017/db?replicaSet=rs0")).toBe(
      "mongodb://u:********@h1:27017,h2:27017/db?replicaSet=rs0")
    expect(maskSecrets("jdbc:mysql://u:p@ss@h1:3306,h2:3306/db")).toBe(
      "jdbc:mysql://u:********@h1:3306,h2:3306/db")
    expect(maskSecrets("mongodb://u:p@ss@[::1]:27017,h2:27017/db")).toBe(
      "mongodb://u:********@[::1]:27017,h2:27017/db")
    expect(maskSecrets("jdbc:sqlserver://u:p@ss@h1:1433;encrypt=true")).toBe(
      "jdbc:sqlserver://u:********@h1:1433;encrypt=true")
  })

  test("does not mistake ;-separated properties or @-free URLs for userinfo", () => {
    expect(maskSecrets("jdbc:sqlserver://h.example.com:1433;databaseName=db;user=u")).toBe(
      "jdbc:sqlserver://h.example.com:1433;databaseName=db;user=u")
    expect(maskSecrets("http://h.example.com/a/b?next=x")).toBe("http://h.example.com/a/b?next=x")
  })

  test("masks brace-escaped SQL Server values without cutting at ';'", () => {
    expect(maskSecrets("jdbc:sqlserver://h.example.com:1433;password={p@ss;w0rd};encrypt=true")).toBe(
      "jdbc:sqlserver://h.example.com:1433;password=********;encrypt=true")
    // `}}` inside a braced value is an escaped }, not the terminator
    expect(maskSecrets("jdbc:sqlserver://h.example.com;password={a}}b};loginTimeout=3")).toBe(
      "jdbc:sqlserver://h.example.com;password=********;loginTimeout=3")
    // non-secret braced values stay readable and later properties still parse
    expect(maskSecrets("jdbc:sqlserver://h.example.com;appName={my;app};encrypt=true")).toBe(
      "jdbc:sqlserver://h.example.com;appName={my;app};encrypt=true")
  })

  test("masks JSON strings with leading whitespace or a top-level array", () => {
    expect(maskSecrets('  {"password":"fake-pw"}')).toBe('{"password":"********"}')
    expect(maskSecrets('[{"token":"fake-token"},{"bucket":"b"}]')).toBe('[{"token":"********"},{"bucket":"b"}]')
  })

  test("returns secret-free JSON strings byte-for-byte", () => {
    const original = '{ "bucket": "b", "large": 12345678901234567890 }'
    expect(maskSecrets(original)).toBe(original)
  })

  test("masks kebab-case, dotted and other common credential key spellings", () => {
    const masked = maskSecrets({
      "access-key-id": "{{SECRET_kf18vs2l}}",
      "api-key": "fake-token",
      "private-key": "-----BEGIN...",
      "private.key": "-----BEGIN...",
      credentials: "{{SECRET_bms7gq2x}}",
      "private_key_passphrase": "{{SECRET_3owkrqvn}}",
      host: "h.example.com",
    }) as Record<string, unknown>
    for (const key of ["access-key-id", "api-key", "private-key", "private.key", "credentials", "private_key_passphrase"])
      expect(masked[key]).toBe("********")
    expect(masked.host).toBe("h.example.com")
  })

  test("masks whole JAAS config values that embed credentials", () => {
    const masked = maskSecrets({
      "sasl.jaas.config": 'org.apache.kafka.PlainLoginModule required username="u" password="x";',
    }) as Record<string, unknown>
    expect(masked["sasl.jaas.config"]).toBe("********")
    expect(maskSecrets('jdbc:kafka://b.example.com:9092?sasl.jaas.config=PlainLoginModule required username="u" password="x"&timeout=1000')).toBe(
      "jdbc:kafka://b.example.com:9092?sasl.jaas.config=********&timeout=1000")
  })

  test("leaves empty and missing secrets as-is so NULL stays distinguishable", () => {
    const masked = maskSecrets({ access_key_id: "", access_key_secret: null }) as Record<string, unknown>
    expect(masked.access_key_id).toBe("")
    expect(masked.access_key_secret).toBeNull()
    expect(maskSecrets(undefined)).toBeUndefined()
  })
})
