import { expect, test } from "bun:test"

const region = "ap-southeast-1-aws"
const instance = { id: 42, name: "demo", regionId: 64, cspId: 3, serviceId: 1 }
const token = `header.${Buffer.from(JSON.stringify({ userId: 7, accountId: 9 })).toString("base64url")}.signature`

async function run(
  command: string,
  options: {
    region?: string
    instances?: unknown[]
    catalog?: boolean
    instanceStatus?: number
    businessCode?: number
    workspaceStatus?: number
    loginInstance?: number
  } = {},
) {
  const requests: string[] = []
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      requests.push(`${request.method} ${url.pathname}${url.search}`)
      if (url.pathname.endsWith("/user/loginSingle")) {
        return Response.json({ code: 0, data: { token, instanceId: options.loginInstance ?? 42, userId: 7 } })
      }
      if (url.pathname.endsWith("/service/serviceInstanceList")) {
        return Response.json({ code: options.businessCode ?? 0, data: options.instances ?? [instance] }, { status: options.instanceStatus ?? 200 })
      }
      if (options.catalog && url.pathname.endsWith("/csp/list")) {
        return Response.json({ code: 0, data: [{ id: 3, code: "aws", name: "AWS" }] })
      }
      if (options.catalog && url.pathname.endsWith("/region/list")) {
        return Response.json({ code: 0, data: [{ id: 64, cregionId: region, name: "Singapore" }] })
      }
      if (url.pathname.endsWith("/workspace/listUserWorkspaces")) {
        return Response.json({ code: 0, data: [{ showName: "workspace", workspaceId: "123", projectId: 8 }] }, { status: options.workspaceStatus ?? 200 })
      }
      return new Response(null, { status: 404 })
    },
  })
  const args = [command, "--studio-url", `https://demo.${region}.app.singdata.com/ide`,
    "--service", server.url.href, "--username", "user", "--password", "test-password",
    ...(command === "discover" ? [] : ["--region", options.region ?? region]),
    ...(command === "render-command" ? ["--workspace", "workspace", "--vcluster", "TEST_AP"] : [])]
  const program = `
    import yargs from "yargs"
    import { registerBootstrapCommands } from "./src/commands/profile-bootstrap.ts"
    const cli = yargs().option("format", { type: "string", default: "json" })
    registerBootstrapCommands(cli)
    await cli.parseAsync(${JSON.stringify(args)})
  `
  try {
    const child = Bun.spawn([process.execPath, "--conditions=browser", "--eval", program], {
      cwd: `${import.meta.dir}/..`, stdout: "pipe", stderr: "pipe",
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ])
    expect(stderr).toBe("")
    return { output: JSON.parse(stdout.trim()), code, requests }
  } finally {
    server.stop(true)
  }
}

test("discover recovers the authenticated region when the catalog is unavailable", async () => {
  const result = await run("discover")
  expect(result.code).toBe(0)
  expect(result.output.data.regions).toMatchObject([{ region_id: 64, region_key: region }])
  expect(result.output.data.instances).toMatchObject([{ instance_id: 42, instance_name: "demo" }])
  expect(result.output.data.warnings.join(" ")).toContain("/csp/list: HTTP 404")
})

test("render-command uses the URL instance among multiple instances", async () => {
  const result = await run("render-command", { instances: [instance, { ...instance, id: 43, name: "other" }] })
  expect(result.code).toBe(0)
  expect(result.output.data.command).toContain("--instance demo")
  expect(result.output.data.command).toContain("--vcluster TEST_AP")
  expect(result.output.data.command).not.toContain("test-password")
})

test("list-workspaces uses recovered region metadata", async () => {
  const result = await run("list-workspaces")
  expect(result.code).toBe(0)
  expect(result.output.data.workspaces_by_instance.demo).toEqual([{ workspace_name: "workspace", workspace_id: "123", project_id: 8 }])
})

test("a different region is rejected rather than assigned to the login instance", async () => {
  const result = await run("render-command", { region: "cn-shanghai-alicloud" })
  expect(result.code).toBe(1)
  expect(result.output.error.message).toContain("not found")
})

test("numeric region IDs remain supported", async () => {
  const result = await run("render-command", { catalog: true, region: "64" })
  expect(result.code).toBe(0)
  expect(result.requests).toContain("GET /clickzetta-portal/service/serviceInstanceList?accountId=9")
  expect(result.output.data.region.region_name).toBe("Singapore")
})

test("instance HTTP errors are reported without falling back or returning empty lists", async () => {
  const result = await run("discover", { instanceStatus: 403 })
  expect(result.code).toBe(1)
  expect(result.output.error.message).toContain("HTTP 403")
  expect(result.requests).not.toContain("POST /clickzetta-portal/service/listInstances")
})

test("HTTP 200 business errors are reported", async () => {
  const result = await run("discover", { businessCode: 5014 })
  expect(result.code).toBe(1)
  expect(result.output.error.message).toContain("API error 5014")
})

test("region discovery errors remain visible without a matching authenticated instance", async () => {
  const result = await run("render-command", { loginInstance: 99 })
  expect(result.code).toBe(1)
  expect(result.output.error.message).toContain("Region discovery failed")
  expect(result.output.error.message).toContain("HTTP 404")
})

test("workspace request failures are not reported as empty successful results", async () => {
  const result = await run("list-workspaces", { catalog: true, workspaceStatus: 403 })
  expect(result.code).toBe(1)
  expect(result.output.error.code).toBe("BOOTSTRAP_ERROR")
})

test("available catalogs retain region names and accept instance field aliases", async () => {
  const result = await run("render-command", {
    catalog: true,
    region: "Singapore",
    instances: [{ instanceId: 42, instanceName: "demo", regionId: 64, cspId: 3, serviceId: 1 }],
  })
  expect(result.code).toBe(0)
  expect(result.output.data.region).toMatchObject({ region_id: 64, region_name: "Singapore", csp_code: "AWS" })
  expect(result.output.data.warnings).toBeUndefined()
  expect(result.requests).not.toContain("POST /clickzetta-portal/service/listInstances")
})


test("missing instance endpoints surface the 404 without trying another route", async () => {
  const result = await run("discover", { instanceStatus: 404 })
  expect(result.code).toBe(1)
  expect(result.output.error.message).toContain("HTTP 404")
  expect(result.requests.filter((request) => request.includes("/service/"))).toEqual([
    "GET /clickzetta-portal/service/serviceInstanceList?accountId=9",
  ])
})
