import { onFetch, onPath } from "./fetch-boundary.js"

/**
 * ClickZetta-specific test fixtures layered on the generic fetch boundary.
 * Knows the backend URL paths and the wire shapes the SDK expects, so tests can
 * stub named operations instead of hand-building responses.
 */

/** Standard studio envelope. The SDK's studioRequest treats `code === 0` as success. */
export function studioOk<T>(data: T): { code: number; data: T } {
  return { code: 0, data }
}

/**
 * Stub a Studio/gateway call matched by URL path substring, returning
 * `{ code: 0, data }`. `respond` receives the parsed request body.
 */
export function onStudio(pathIncludes: string, respond: (body: unknown) => unknown): void {
  onPath(pathIncludes, respond)
}

/** Re-export the raw handler for callers needing URL/query/header access. */
export { onFetch, onPath }

/**
 * Build a `/lh/submitJob` (or getJob) response for a SUCCEEDED SQL job with
 * embedded TEXT results, matching the wire shape parseJobResponse expects:
 * fields in `resultSet.metadata`, rows base64-encoded in `resultSet.data.data`
 * (rows newline-separated, columns comma-separated). Column categories are
 * inferred from the first non-null value so numeric/boolean columns decode back
 * to their JS types (coerceValue keys off the category), matching real results.
 */
export function sqlSuccess(columns: string[], rows: unknown[][]): unknown {
  const categoryOf = (col: number): string => {
    const sample = rows.find((row) => row[col] != null)?.[col]
    if (typeof sample === "number") return "INT32"
    if (typeof sample === "boolean") return "BOOLEAN"
    return "STRING"
  }
  const encoded = rows.map((row) => row.map((v) => (v == null ? "" : String(v))).join(",")).join("\n")
  return {
    status: { state: "SUCCEED" },
    resultSet: {
      metadata: {
        format: "TEXT",
        fields: columns.map((name, col) => ({ name, type: { category: categoryOf(col), nullable: true } })),
      },
      data: { data: encoded ? [Buffer.from(encoded, "utf-8").toString("base64")] : [] },
    },
  }
}

/** Build a FAILED SQL job response carrying an error code/message. */
export function sqlFailure(errorCode: string, errorMessage: string): unknown {
  return { status: { state: "FAILED", errorCode, errorMessage } }
}

/** Overridable identity/workspace values resolved before any domain call. */
export interface StudioContextStub {
  token: string
  userId: number
  instanceId: number
  tenantId: number
  workspaceName: string
  workspaceId: number
  projectId: number
  userName: string
}

const DEFAULT_CONTEXT: StudioContextStub = {
  token: "test-token",
  userId: 13,
  instanceId: 86,
  tenantId: 10,
  workspaceName: "wanxin_test_04",
  workspaceId: 7162858493138728877,
  projectId: 41004,
  userName: "UAT_TEST",
}

/**
 * Register the auth/context plumbing every studio command drives before its
 * domain calls: portal login, current user, instance-id resolution, and
 * workspace lookup. Studio tests call this once, then register their own domain
 * fixtures. Returns the resolved context so callers can assert against it.
 */
export function stubStudioContext(overrides: Partial<StudioContextStub> = {}): StudioContextStub {
  const ctx = { ...DEFAULT_CONTEXT, ...overrides }
  onStudio("/clickzetta-portal/user/loginSingle", () =>
    studioOk({ token: ctx.token, instanceId: ctx.instanceId, userId: ctx.userId, expireTime: 3_600_000 }),
  )
  onStudio("/clickzetta-portal/user/getCurrentUser", () =>
    studioOk({ id: ctx.userId, name: ctx.userName, accountId: ctx.tenantId }),
  )
  onStudio("/clickzetta-portal/service/serviceInstanceList", () =>
    studioOk([{ id: ctx.instanceId, name: "inst", instanceName: "inst" }]),
  )
  onStudio("/ide-authority/v1/workspace/listUserWorkspaces", () =>
    studioOk([{ workspaceId: ctx.workspaceId, workspaceName: ctx.workspaceName, projectId: ctx.projectId }]),
  )
  return ctx
}
