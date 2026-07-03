import { expect, test } from "bun:test"
import { parseJdbcUrl } from "../src/connection/jdbc"

test("parseJdbcUrl preserves the port in service (bug-37)", () => {
  const cfg = parseJdbcUrl(
    "jdbc:clickzetta://1923808b.10.155.2.214:8033/ab_test?username=ks_bjadmin&password=secret&schema=public&vcluster=DEFAULT&use_http=true",
  )
  expect(cfg).toBeDefined()
  expect(cfg!.instance).toBe("1923808b")
  // service must carry the port so toServiceUrl builds http://10.155.2.214:8033
  expect(cfg!.service).toBe("10.155.2.214:8033")
})

test("parseJdbcUrl reads vcluster alias (bug-37)", () => {
  const cfg = parseJdbcUrl(
    "jdbc:clickzetta://1923808b.10.155.2.214:8033/ab_test?vcluster=DEFAULT",
  )
  expect(cfg!.vcluster).toBe("DEFAULT")
})

test("parseJdbcUrl reads virtualcluster lowercase alias", () => {
  const cfg = parseJdbcUrl(
    "jdbc:clickzetta://abc.api.clickzetta.com/ws?virtualcluster=mycluster",
  )
  expect(cfg!.vcluster).toBe("mycluster")
})

test("parseJdbcUrl reads virtualCluster camelCase alias", () => {
  const cfg = parseJdbcUrl(
    "jdbc:clickzetta://abc.api.clickzetta.com/ws?virtualCluster=cc",
  )
  expect(cfg!.vcluster).toBe("cc")
})

test("parseJdbcUrl without port leaves service portless", () => {
  const cfg = parseJdbcUrl(
    "jdbc:clickzetta://abc.cn-hangzhou-alicloud.api.clickzetta.com/ws?schema=public",
  )
  expect(cfg!.service).toBe("cn-hangzhou-alicloud.api.clickzetta.com")
})

test("parseJdbcUrl maps use_http=true to http protocol", () => {
  const cfg = parseJdbcUrl(
    "jdbc:clickzetta://abc.10.0.0.1:8033/ws?use_http=true",
  )
  expect(cfg!.protocol).toBe("http")
})

test("parseJdbcUrl handles /api/ path prefix in service", () => {
  const cfg = parseJdbcUrl(
    "jdbc:clickzetta://a1b2c3d4.lakehouse-studio.uat.example.com/api/my_workspace?username=user&password=secret&schema=public&virtualCluster=DEFAULT",
  )
  expect(cfg).toBeDefined()
  expect(cfg!.instance).toBe("a1b2c3d4")
  expect(cfg!.service).toBe("lakehouse-studio.uat.example.com/api")
  expect(cfg!.workspace).toBe("my_workspace")
  expect(cfg!.username).toBe("user")
  expect(cfg!.password).toBe("secret")
  expect(cfg!.vcluster).toBe("DEFAULT")
  expect(cfg!.schema).toBe("public")
})