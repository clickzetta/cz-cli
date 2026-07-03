# cz-cli TypeScript 全量重写 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the Python cz-cli into TypeScript across three packages (clickzetta-sdk, cz-cli, opencode modifications), eliminating the Python dependency while preserving all CLI commands and behavior.

**Architecture:** Three-layer monorepo packages — `clickzetta-sdk` (HTTP client + types), `cz-cli` (CLI commands compiled to `cz-tool` binary), and `opencode` modifications (rename to `czcli`, route `agent` to opencode, others to `cz-tool`, register `cz-tool` as built-in tool). All ClickZetta backend communication is standard HTTP REST with JSON bodies and `X-Clickzetta-Token` auth.

**Tech Stack:** TypeScript, Bun, yargs (CLI), smol-toml (TOML), Effect (in opencode tool layer), Zod (schemas)

**Source Reference:** Python implementation at `~/code/cz-cli/` — all behavior must match 1:1.

---

## File Structure

### New Package: `packages/clickzetta-sdk/`

| File | Responsibility |
|------|---------------|
| `package.json` | Package config, dependencies |
| `tsconfig.json` | TypeScript config |
| `src/index.ts` | Public API exports |
| `src/client.ts` | Unified HTTP client (retry, timeout, headers, error handling) |
| `src/auth/login.ts` | `loginSingle()` — PAT and username/password login |
| `src/auth/token.ts` | Token cache, expiry detection (0.8 factor), auto-refresh |
| `src/auth/user.ts` | `getCurrentUser()`, `getUserConfig()`, `getInstanceByName()` |
| `src/sql/submit.ts` | `/lh/submitJob` — SQL job submission |
| `src/sql/poll.ts` | `/lh/getJob` — poll for results with timeout |
| `src/sql/cancel.ts` | `/lh/cancelJob` — cancel running job |
| `src/sql/split.ts` | SQL statement splitting (port from Python `utils.split_sql`) |
| `src/sql/types.ts` | `QueryResult`, `JobStatus`, `JobID`, column/row types |
| `src/studio/task.ts` | Task CRUD via `/ide-admin/v1/` endpoints |
| `src/studio/runs.ts` | Run instances via `/ide-admin/v1/taskInst/` endpoints |
| `src/studio/flow.ts` | Flow DAG via `/ide-admin/v1/flow/` endpoints |
| `src/studio/attempts.ts` | Attempt records and logs |
| `src/studio/execute.ts` | Adhoc execution via `/ide-admin/v1/adhoc/execute` |
| `src/studio/folder.ts` | Folder management via `/ide-admin/v1/` endpoints |
| `src/studio/schedule.ts` | Schedule task operations |
| `src/workspace/workspace.ts` | `listUserWorkspaces()` via `/ide-authority/v1/` |
| `src/agent/chat.ts` | AI Agent conversation via `/ai/api/` endpoints |
| `src/config/region.ts` | Region detection from service URL |
| `src/config/connection.ts` | Connection config resolution (priority chain) |
| `src/types/index.ts` | Shared types: `ConnectionConfig`, `StudioConfig`, `AuthToken` |
| `src/types/api.ts` | API response envelope: `{ code, message, data }` |

### New Package: `packages/cz-cli/`

| File | Responsibility |
|------|---------------|
| `package.json` | Package config, depends on `clickzetta-sdk` |
| `tsconfig.json` | TypeScript config |
| `src/index.ts` | cz-tool entry point |
| `src/cli.ts` | yargs root group with global options injection |
| `src/commands/sql.ts` | SQL execution with safety guardrails |
| `src/commands/profile.ts` | Profile CRUD + discover + list-workspaces |
| `src/commands/schema.ts` | Schema list/describe/create/drop |
| `src/commands/table.ts` | Table list/describe/preview/stats/history/create/drop |
| `src/commands/workspace.ts` | Workspace list/use |
| `src/commands/task.ts` | Task CRUD + flow subcommands |
| `src/commands/runs.ts` | Run instances management |
| `src/commands/attempts.ts` | Attempt records and logs |
| `src/commands/agent.ts` | AI Agent status/ask |
| `src/commands/job.ts` | Job performance analysis |
| `src/commands/status.ts` | Version and connection status |
| `src/commands/ai-guide.ts` | AI agent command reference output |
| `src/commands/install-skills.ts` | Install AI skills to external agents |
| `src/connection/config.ts` | Connection config resolution (CLI args > JDBC > env > profile > defaults) |
| `src/connection/profile-store.ts` | `~/.clickzetta/profiles.toml` read/write (atomic) |
| `src/connection/jdbc.ts` | JDBC URL parsing |
| `src/output/formatter.ts` | Output formatting (json/pretty/table/csv/jsonl/toon) |
| `src/output/masking.ts` | Sensitive data masking (phone/email/password/idcard) |
| `src/output/index.ts` | `success()`, `error()`, `successRows()` + exit codes |
| `src/logger.ts` | Operation logging to `~/.clickzetta/sql-history.jsonl` |
| `src/guide-builder.ts` | AI guide generation |
| `src/version.ts` | Version constant |

### Modified in `packages/opencode/`

| File | Change |
|------|--------|
| `src/index.ts` | Rename binary to `czcli`, update routing logic |
| `src/cli/cmd/forward.ts` | Update cz-tool binary path resolution |
| `src/cli/cmd/tui/brand.ts` | Update brand name to `czcli` |
| `src/tool/cz-tool.ts` | **New** — register cz-tool as built-in opencode tool |
| `src/tool/registry.ts` | Register cz-tool in builtin tools |
| `src/installation/index.ts` | Remove Python cz-cli download/install logic |
| `src/cli/cmd/profile.ts` | **Delete** — unified into packages/cz-cli |
| `src/profile/index.ts` | **Delete** — unified into packages/cz-cli |
| `script/build.ts` | Build cz-tool from packages/cz-cli, bundle into dist |
| `package.json` | Add dependency on `@clickzetta/sdk` |

---

## Task 1: Scaffold `packages/clickzetta-sdk` package

**Files:**
- Create: `packages/clickzetta-sdk/package.json`
- Create: `packages/clickzetta-sdk/tsconfig.json`
- Create: `packages/clickzetta-sdk/src/index.ts`
- Create: `packages/clickzetta-sdk/src/types/index.ts`
- Create: `packages/clickzetta-sdk/src/types/api.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@clickzetta/sdk",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "smol-toml": "catalog:"
  },
  "devDependencies": {
    "typescript": "catalog:"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Reference the root tsconfig pattern from other packages in the monorepo. Check `packages/opencode/tsconfig.json` for the exact extends path and compiler options, then mirror them.

- [ ] **Step 3: Create core types in `src/types/index.ts`**

Port from Python `connection.py` ConnectionConfig dataclass:

```typescript
export interface ConnectionConfig {
  pat: string
  username: string
  password: string
  service: string
  protocol: string
  instance: string
  workspace: string
  schema: string
  vcluster: string
  customHeaders?: Record<string, string>
}

export const DEFAULT_CONNECTION: ConnectionConfig = {
  pat: "",
  username: "",
  password: "",
  service: "dev-api.clickzetta.com",
  protocol: "https",
  instance: "",
  workspace: "",
  schema: "public",
  vcluster: "default",
}

export interface AuthToken {
  token: string
  instanceId: number
  userId: number
  expireTimeMs: number
  obtainedAt: number
}

export interface StudioConfig {
  token: string
  instanceId: number
  workspaceId: number
  projectId: number
  userId: number
  tenantId: number
  instanceName: string
  workspaceName: string
  env: string
  baseUrl: string
  customHeaders?: Record<string, string>
}
```

- [ ] **Step 4: Create API response types in `src/types/api.ts`**

```typescript
export interface ApiResponse<T = unknown> {
  code: number | string
  message?: string
  data: T
}

export interface SqlJobResponse {
  jobId: string
  status: string
  resultData?: unknown
  schema?: Array<{ name: string; type: string }>
  errorCode?: string
  errorMessage?: string
}

export class ClickZettaApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode?: number,
  ) {
    super(message)
    this.name = "ClickZettaApiError"
  }
}
```

- [ ] **Step 5: Create `src/index.ts` with re-exports**

```typescript
export * from "./types/index.js"
export * from "./types/api.js"
```

- [ ] **Step 6: Run `bun install` from repo root to link the new workspace package**

Run: `bun install`
Expected: Package linked successfully, no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/clickzetta-sdk/
git commit -m "feat(clickzetta-sdk): scaffold package with core types"
```

---

## Task 2: Implement HTTP client and auth module

**Files:**
- Create: `packages/clickzetta-sdk/src/client.ts`
- Create: `packages/clickzetta-sdk/src/auth/login.ts`
- Create: `packages/clickzetta-sdk/src/auth/token.ts`
- Create: `packages/clickzetta-sdk/src/auth/user.ts`
- Create: `packages/clickzetta-sdk/src/config/region.ts`

- [ ] **Step 1: Implement HTTP client**

Port retry logic from Python `client.py` (2 retries, exponential backoff 0.5s/1s). Reference: `~/code/cz-cli/cz_cli/studio_client.py` lines 223-255 and `/private/tmp/cz_mcp_inspect/cz_mcp/utils/request_utils.py`.

`packages/clickzetta-sdk/src/client.ts`:

```typescript
import { ClickZettaApiError, type ApiResponse } from "./types/api.js"

const MAX_RETRIES = 2
const RETRY_DELAYS = [500, 1000]

export interface ClientOptions {
  baseUrl: string
  token?: string
  customHeaders?: Record<string, string>
  timeout?: number
}

export async function request<T>(
  options: ClientOptions,
  path: string,
  body?: unknown,
  method: string = "POST",
): Promise<ApiResponse<T>> {
  const url = `${options.baseUrl}${path}`
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    ...options.customHeaders,
  }
  if (options.token) {
    headers["X-Clickzetta-Token"] = options.token
  }

  let lastError: Error | undefined
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: options.timeout
          ? AbortSignal.timeout(options.timeout)
          : undefined,
      })
      const text = await resp.text()
      if (!resp.ok) {
        const parsed = tryParseJson(text)
        if (parsed && typeof parsed === "object" && "code" in parsed) {
          return parsed as ApiResponse<T>
        }
        throw new ClickZettaApiError(
          `HTTP_${resp.status}`,
          `HTTP ${resp.status}: ${text}`,
          resp.status,
        )
      }
      return JSON.parse(text) as ApiResponse<T>
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAYS[attempt])
        continue
      }
    }
  }
  throw lastError
}

function tryParseJson(text: string): unknown {
  try { return JSON.parse(text) } catch { return undefined }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
```

- [ ] **Step 2: Implement region detection**

Port from `/private/tmp/cz_mcp_inspect/cz_mcp/core/region_config.py`. Maps service URL to environment name.

`packages/clickzetta-sdk/src/config/region.ts`:

```typescript
export function detectEnv(service: string): string {
  if (service.includes("dev-api.")) return "dev"
  if (service.includes("sit-api.")) return "sit"
  if (service.includes("uat-api.")) return "uat"
  const match = service.match(/^([^.]+)\.api\.(clickzetta|singdata)\.com/)
  if (match) return match[1]
  return "prod"
}

export function buildBaseUrl(protocol: string, service: string): string {
  return `${protocol}://${service}`
}
```

- [ ] **Step 3: Implement login**

Port from `/private/tmp/cz_mcp_inspect/cz_mcp/handlers/login_server.py`. Two modes: PAT and username/password.

`packages/clickzetta-sdk/src/auth/login.ts`:

```typescript
import { request, type ClientOptions } from "../client.js"
import type { AuthToken } from "../types/index.js"

interface LoginResponse {
  token: string
  instanceId: number
  userId: number
  expireTime: number
}

export async function loginWithPat(
  baseUrl: string,
  pat: string,
  instanceName: string,
): Promise<AuthToken> {
  const opts: ClientOptions = { baseUrl, timeout: 10000 }
  const resp = await request<LoginResponse>(
    opts,
    "/clickzetta-portal/user/loginSingle",
    { accessToken: pat, instanceName },
  )
  if (resp.code !== 0) {
    throw new Error(`Login failed: ${resp.message ?? JSON.stringify(resp)}`)
  }
  return {
    token: resp.data.token,
    instanceId: resp.data.instanceId,
    userId: resp.data.userId,
    expireTimeMs: resp.data.expireTime,
    obtainedAt: Date.now(),
  }
}

export async function loginWithPassword(
  baseUrl: string,
  username: string,
  password: string,
  instanceName: string,
): Promise<AuthToken> {
  const opts: ClientOptions = { baseUrl, timeout: 10000 }
  const resp = await request<LoginResponse>(
    opts,
    "/clickzetta-portal/user/loginSingle",
    { username, password, instanceName },
  )
  if (resp.code !== 0) {
    throw new Error(`Login failed: ${resp.message ?? JSON.stringify(resp)}`)
  }
  return {
    token: resp.data.token,
    instanceId: resp.data.instanceId,
    userId: resp.data.userId,
    expireTimeMs: resp.data.expireTime,
    obtainedAt: Date.now(),
  }
}
```

- [ ] **Step 4: Implement token management**

Port expiry logic from Python `client.py` lines 1473-1481 (DEFAULT_EXPIRED_FACTOR = 0.8).

`packages/clickzetta-sdk/src/auth/token.ts`:

```typescript
import type { AuthToken, ConnectionConfig } from "../types/index.js"
import { loginWithPat, loginWithPassword } from "./login.js"
import { buildBaseUrl } from "../config/region.js"

const EXPIRED_FACTOR = 0.8

let cachedToken: AuthToken | undefined
let cachedKey: string | undefined

export function isTokenExpired(token: AuthToken): boolean {
  if (!token.expireTimeMs || token.expireTimeMs === 0) return false
  const elapsed = Date.now() - token.obtainedAt
  return elapsed > token.expireTimeMs * EXPIRED_FACTOR
}

export async function getToken(config: ConnectionConfig): Promise<AuthToken> {
  const key = `${config.instance}:${config.pat || config.username}`
  if (cachedToken && cachedKey === key && !isTokenExpired(cachedToken)) {
    return cachedToken
  }
  const baseUrl = buildBaseUrl(config.protocol, config.service)
  const token = config.pat
    ? await loginWithPat(baseUrl, config.pat, config.instance)
    : await loginWithPassword(
        baseUrl,
        config.username,
        config.password,
        config.instance,
      )
  cachedToken = token
  cachedKey = key
  return token
}

export function clearTokenCache(): void {
  cachedToken = undefined
  cachedKey = undefined
}
```

- [ ] **Step 5: Implement user info endpoints**

Port from `/private/tmp/cz_mcp_inspect/cz_mcp/handlers/login_server.py`.

`packages/clickzetta-sdk/src/auth/user.ts`:

```typescript
import { request, type ClientOptions } from "../client.js"

interface UserInfo {
  id: number
  accountId: number
  name: string
  instanceId: number
}

export async function getCurrentUser(
  baseUrl: string,
  token: string,
): Promise<UserInfo> {
  const opts: ClientOptions = { baseUrl, token }
  const resp = await request<UserInfo>(
    opts,
    "/clickzetta-portal/user/getCurrentUser",
    {},
  )
  if (resp.code !== 0) {
    throw new Error(`Failed to get user: ${resp.message}`)
  }
  return resp.data
}

interface InstanceInfo {
  id: number
}

export async function getInstanceByName(
  baseUrl: string,
  token: string,
  instanceName: string,
): Promise<number> {
  const opts: ClientOptions = { baseUrl, token }
  const resp = await request<InstanceInfo>(
    opts,
    `/clickzetta-portal/service/getInstanceByName?instanceName=${encodeURIComponent(instanceName)}`,
    undefined,
    "GET",
  )
  if (resp.code !== 0) {
    throw new Error(`Instance not found: ${instanceName}`)
  }
  return resp.data.id
}
```

- [ ] **Step 6: Update `src/index.ts` exports**

```typescript
export * from "./types/index.js"
export * from "./types/api.js"
export * from "./client.js"
export * from "./auth/login.js"
export * from "./auth/token.js"
export * from "./auth/user.js"
export * from "./config/region.js"
```

- [ ] **Step 7: Verify compilation**

Run: `cd packages/clickzetta-sdk && bunx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/clickzetta-sdk/
git commit -m "feat(clickzetta-sdk): HTTP client, auth, token management, region detection"
```

---

## Task 3: Implement SQL execution module in SDK

**Files:**
- Create: `packages/clickzetta-sdk/src/sql/types.ts`
- Create: `packages/clickzetta-sdk/src/sql/submit.ts`
- Create: `packages/clickzetta-sdk/src/sql/poll.ts`
- Create: `packages/clickzetta-sdk/src/sql/cancel.ts`
- Create: `packages/clickzetta-sdk/src/sql/split.ts`

- [ ] **Step 1: Create SQL types**

Port from Python `client.py` JobID, QueryResult, QueryDataType, and status enums.

`packages/clickzetta-sdk/src/sql/types.ts`:

```typescript
export interface JobID {
  id: string
}

export enum JobStatus {
  SUBMITTED = "SUBMITTED",
  RUNNING = "RUNNING",
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
  UNKNOWN = "UNKNOWN",
}

export interface ColumnSchema {
  name: string
  type: string
}

export interface QueryResult {
  jobId: string
  status: JobStatus
  columns: ColumnSchema[]
  rows: Record<string, unknown>[]
  rowCount: number
  affectedRows: number
  errorCode?: string
  errorMessage?: string
}

export function newJobId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return `tssdk-${hex}`
}
```

- [ ] **Step 2: Implement submitJob**

Port from Python `client.py` lines 569-700. Reference the exact request body structure.

`packages/clickzetta-sdk/src/sql/submit.ts` — read Python `client.py` `submit_sql_job()` and `_handle_submit_sql()` for the exact JSON body fields (`jobId`, `sql`, `workspace`, `instance`, `vcluster`, `schema`, `jobType`, `requestMode`, `hints`, etc.), then implement the equivalent POST to `/lh/submitJob`.

- [ ] **Step 3: Implement getJob (poll)**

Port from Python `client.py` `_get_query_result()`. Polls `/lh/getJob` until status is terminal.

`packages/clickzetta-sdk/src/sql/poll.ts` — implement polling loop with configurable timeout (default 30s polling interval matching Python's `polling_timeout`). Parse the response into `QueryResult` with columns and rows.

- [ ] **Step 4: Implement cancelJob**

Port from Python `client.py` lines 1088-1100.

`packages/clickzetta-sdk/src/sql/cancel.ts`:

```typescript
import { request, type ClientOptions } from "../client.js"

export async function cancelJob(
  opts: ClientOptions,
  jobId: string,
  instanceId: number,
): Promise<void> {
  await request(opts, "/lh/cancelJob", {
    jobId,
    instanceId,
  })
}
```

- [ ] **Step 5: Implement SQL splitting**

Port from Python `clickzetta.connector.v0.utils.split_sql`. Read the Python source at `/opt/homebrew/lib/python3.14/site-packages/clickzetta/connector/v0/utils.py` for the exact logic (handles quoted strings, comments, semicolons).

`packages/clickzetta-sdk/src/sql/split.ts` — implement `splitSql(sql: string): string[]` that handles:
- Single-line comments (`--`)
- Multi-line comments (`/* */`)
- Quoted strings (single and double quotes, with escape handling)
- Semicolon as statement delimiter
- Strips empty statements

- [ ] **Step 6: Update index.ts exports**

Add to `packages/clickzetta-sdk/src/index.ts`:

```typescript
export * from "./sql/types.js"
export * from "./sql/submit.js"
export * from "./sql/poll.js"
export * from "./sql/cancel.js"
export * from "./sql/split.js"
```

- [ ] **Step 7: Verify compilation**

Run: `cd packages/clickzetta-sdk && bunx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/clickzetta-sdk/src/sql/
git commit -m "feat(clickzetta-sdk): SQL execution module (submit, poll, cancel, split)"
```

---

## Task 4: Implement Studio and Workspace modules in SDK

**Files:**
- Create: `packages/clickzetta-sdk/src/studio/task.ts`
- Create: `packages/clickzetta-sdk/src/studio/runs.ts`
- Create: `packages/clickzetta-sdk/src/studio/flow.ts`
- Create: `packages/clickzetta-sdk/src/studio/attempts.ts`
- Create: `packages/clickzetta-sdk/src/studio/execute.ts`
- Create: `packages/clickzetta-sdk/src/studio/folder.ts`
- Create: `packages/clickzetta-sdk/src/studio/schedule.ts`
- Create: `packages/clickzetta-sdk/src/studio/client.ts`
- Create: `packages/clickzetta-sdk/src/workspace/workspace.ts`
- Create: `packages/clickzetta-sdk/src/agent/chat.ts`

- [ ] **Step 1: Create Studio client helper**

The Studio endpoints all share the same auth header pattern. Create a helper that builds the standard headers.

`packages/clickzetta-sdk/src/studio/client.ts`:

```typescript
import { request, type ClientOptions } from "../client.js"
import type { StudioConfig } from "../types/index.js"

export function studioRequest<T>(
  config: StudioConfig,
  path: string,
  body: unknown,
  extraHeaders?: Record<string, string>,
) {
  const opts: ClientOptions = {
    baseUrl: config.baseUrl,
    token: config.token,
    customHeaders: {
      instanceName: config.instanceName,
      userId: String(config.userId),
      accountId: String(config.tenantId),
      tenantId: String(config.tenantId),
      instanceId: String(config.instanceId),
      ...config.customHeaders,
      ...extraHeaders,
    },
  }
  return request<T>(opts, path, body)
}
```

- [ ] **Step 2: Implement task operations**

Port from `/private/tmp/cz_mcp_inspect/cz_mcp/handlers/ide_admin_server.py`. Each function maps to one HTTP endpoint. Reference the Python handler files for exact request/response body structures.

`packages/clickzetta-sdk/src/studio/task.ts` — implement:
- `listTasks(config, params)` → POST `/ide-admin/v1/ai/mcp/listFiles`
- `createTask(config, params)` → POST `/ide-admin/v1/dataFile/addAndReturnId`
- `getTaskDetail(config, fileId)` → GET `/ide-admin/v1/dataFile/getDetail`
- `getTaskConfigDetail(config, fileId)` → POST `/ide-admin/v1/dataFileConfiguration/getFileConfigurationDetail`
- `saveTaskContent(config, params)` → POST `/ide-admin/v1/dataFileConfiguration/saveDataFileConfiguration`
- `submitTask(config, params)` → POST `/ide-admin/v1/dataFile/submit`
- `onlineTask(config, taskId)` → POST (online endpoint from api_properties.ini)
- `offlineTask(config, taskId)` → POST (offline endpoint)
- `getTaskDependencies(config, fileId)` → POST dependency endpoint

- [ ] **Step 3: Implement runs operations**

Port from `/private/tmp/cz_mcp_inspect/cz_mcp/handlers/execute_server.py` and api_properties.ini.

`packages/clickzetta-sdk/src/studio/runs.ts` — implement:
- `listRuns(config, params)` → POST `/ide-admin/v1/taskInst/list`
- `getRunDetail(config, instanceId)` → POST `/ide-admin/v1/taskInst/getDetail`
- `stopRun(config, instanceId)` → POST `/ide-admin/v1/taskInst/stopTaskInstance`
- `rerunInstance(config, instanceId)` → POST `/ide-admin/v1/taskInst/reRunTaskInstance`
- `createBackfill(config, params)` → POST complement endpoint
- `getRunStats(config, params)` → POST stats endpoint

- [ ] **Step 4: Implement flow operations**

Port from `/private/tmp/cz_mcp_inspect/cz_mcp/handlers/flow_task_server.py`.

`packages/clickzetta-sdk/src/studio/flow.ts` — implement:
- `getFlowDag(config, fileId)` → POST `/ide-admin/v1/flow/getDag?dataFileId={id}`
- `createFlowNode(config, params)` → POST `/ide-admin/v1/flow/node/create`
- `bindFlowNode(config, params)` → POST `/ide-admin/v1/flow/node/bind`
- `unbindFlowNode(config, params)` → POST `/ide-admin/v1/flow/node/unbind`
- `removeFlowNode(config, params)` → POST `/ide-admin/v1/flow/node/remove`
- `submitFlow(config, params)` → POST `/ide-admin/v1/flow/submit`
- `listFlowInstances(config, params)` → POST `/ide-admin/v1/flow/inst/listWithExtraInfo`

- [ ] **Step 5: Implement attempts, execute, folder, schedule**

`packages/clickzetta-sdk/src/studio/attempts.ts`:
- `listAttempts(config, runId, params)` → POST attempts list endpoint
- `getAttemptLog(config, runId, attemptId, offset)` → POST attempt log endpoint

`packages/clickzetta-sdk/src/studio/execute.ts`:
- `executeAdhoc(config, params)` → POST `/ide-admin/v1/adhoc/execute`

`packages/clickzetta-sdk/src/studio/folder.ts`:
- `listFolders(config, params)` → POST `/ide-admin/v1/ai/mcp/listFolders`
- `createFolder(config, params)` → POST `/ide-admin/v1/dataFolder/add`

`packages/clickzetta-sdk/src/studio/schedule.ts`:
- `getScheduleDetail(config, taskId)` → POST schedule detail endpoint
- `getScheduleContent(config, taskId)` → POST schedule content endpoint

- [ ] **Step 6: Implement workspace operations**

`packages/clickzetta-sdk/src/workspace/workspace.ts`:

```typescript
import { request, type ClientOptions } from "../client.js"

interface WorkspaceInfo {
  workspaceId: number
  workspaceName: string
  projectId: number
}

export async function listUserWorkspaces(
  baseUrl: string,
  token: string,
  userId: number,
  tenantId: number,
  instanceId: number,
  instanceName: string,
): Promise<WorkspaceInfo[]> {
  const opts: ClientOptions = {
    baseUrl,
    token,
    customHeaders: {
      instanceId: String(instanceId),
      userId: String(userId),
      accountId: String(tenantId),
      instanceName,
      tenantId: String(tenantId),
    },
  }
  const resp = await request<WorkspaceInfo[]>(
    opts,
    "/ide-authority/v1/workspace/listUserWorkspaces",
    {
      forWrite: "true",
      listType: 4,
      pageIndex: 1,
      pageSize: 99999,
      tenantId,
      userId,
    },
  )
  return resp.data ?? []
}

export async function getWorkspaceByName(
  baseUrl: string,
  token: string,
  userId: number,
  tenantId: number,
  instanceId: number,
  instanceName: string,
  workspaceName: string,
): Promise<WorkspaceInfo | undefined> {
  const all = await listUserWorkspaces(
    baseUrl, token, userId, tenantId, instanceId, instanceName,
  )
  return all.find((w) => w.workspaceName === workspaceName)
}
```

- [ ] **Step 7: Implement AI Agent chat**

Port from `~/code/cz-cli/cz_cli/agent_client.py`.

`packages/clickzetta-sdk/src/agent/chat.ts`:

```typescript
import { request, type ClientOptions } from "../client.js"

export async function agentHealth(baseUrl: string): Promise<boolean> {
  try {
    const opts: ClientOptions = { baseUrl, timeout: 5000 }
    await request(opts, "/ai/health", undefined, "GET")
    return true
  } catch {
    return false
  }
}

export async function createConversation(
  baseUrl: string,
  token: string,
  identity: Record<string, unknown>,
): Promise<string> {
  const opts: ClientOptions = {
    baseUrl,
    customHeaders: { "x-clickzetta-token": token },
  }
  const resp = await request<{ conversationId: string }>(
    opts,
    "/ai/api/conversations",
    identity,
  )
  return resp.data.conversationId
}

export async function chat(
  baseUrl: string,
  token: string,
  conversationId: string,
  question: string,
): Promise<string> {
  const opts: ClientOptions = {
    baseUrl,
    customHeaders: { "x-clickzetta-token": token },
    timeout: 300000,
  }
  const resp = await request<{ answer: string }>(
    opts,
    "/ai/api/chat",
    { conversationId, question },
  )
  return resp.data.answer
}
```

- [ ] **Step 8: Update index.ts with all exports**

Add all new module exports to `packages/clickzetta-sdk/src/index.ts`.

- [ ] **Step 9: Verify compilation**

Run: `cd packages/clickzetta-sdk && bunx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 10: Commit**

```bash
git add packages/clickzetta-sdk/src/
git commit -m "feat(clickzetta-sdk): studio, workspace, agent modules"
```

---

## Task 5: Scaffold `packages/cz-cli` and implement connection/output layer

**Files:**
- Create: `packages/cz-cli/package.json`
- Create: `packages/cz-cli/tsconfig.json`
- Create: `packages/cz-cli/src/index.ts`
- Create: `packages/cz-cli/src/version.ts`
- Create: `packages/cz-cli/src/connection/jdbc.ts`
- Create: `packages/cz-cli/src/connection/profile-store.ts`
- Create: `packages/cz-cli/src/connection/config.ts`
- Create: `packages/cz-cli/src/output/masking.ts`
- Create: `packages/cz-cli/src/output/formatter.ts`
- Create: `packages/cz-cli/src/output/index.ts`
- Create: `packages/cz-cli/src/logger.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@clickzetta/cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@clickzetta/sdk": "workspace:*",
    "smol-toml": "catalog:",
    "yargs": "catalog:"
  },
  "devDependencies": {
    "@types/yargs": "catalog:",
    "typescript": "catalog:"
  }
}
```

- [ ] **Step 2: Create tsconfig.json and version.ts**

Mirror tsconfig from clickzetta-sdk.

`packages/cz-cli/src/version.ts`:
```typescript
export const VERSION = "0.1.0"
```

- [ ] **Step 3: Implement JDBC URL parsing**

Port from Python `connection.py` `_parse_jdbc_url()`. Format: `jdbc:clickzetta://<instance>.<service>/<workspace>?params`.

`packages/cz-cli/src/connection/jdbc.ts`:

```typescript
import type { ConnectionConfig } from "@clickzetta/sdk"

export function parseJdbcUrl(
  jdbc: string,
): Partial<ConnectionConfig> | undefined {
  let url = jdbc
  if (url.startsWith("jdbc:")) url = url.slice(5)
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }

  const hostParts = parsed.hostname.split(".")
  if (hostParts.length < 4) return undefined

  const instance = hostParts[0]
  const service = hostParts.slice(1).join(".")
  const workspace = parsed.pathname.replace(/^\//, "") || undefined
  const params = parsed.searchParams

  const result: Partial<ConnectionConfig> = {
    instance,
    service,
  }
  if (workspace) result.workspace = workspace
  if (params.get("username")) result.username = params.get("username")!
  if (params.get("password")) result.password = params.get("password")!
  if (params.get("schema")) result.schema = params.get("schema")!
  if (params.get("virtualCluster")) result.vcluster = params.get("virtualCluster")!
  if (params.get("workspace")) result.workspace = params.get("workspace")!
  if (params.get("protocol")) result.protocol = params.get("protocol")!

  return result
}
```

- [ ] **Step 4: Implement profile store**

Port from Python `connection.py` `_load_profiles()`, `_save_profiles()`. Uses `smol-toml` for TOML parsing. Atomic writes via temp file + rename.

`packages/cz-cli/src/connection/profile-store.ts` — implement:
- `loadProfiles(): Record<string, ProfileEntry>`
- `saveProfiles(profiles: Record<string, ProfileEntry>): void`
- `getDefaultProfileName(): string | undefined`
- `getProfileConfig(name?: string): Partial<ConnectionConfig> | undefined`
- File path: `~/.clickzetta/profiles.toml`
- Handle custom headers: nested dict (`header.X = Y`) and dotted keys

- [ ] **Step 5: Implement connection config resolution**

Port the priority chain from Python `connection.py` `resolve_connection_config()`.

`packages/cz-cli/src/connection/config.ts` — implement:
- `resolveConnectionConfig(cliArgs): ConnectionConfig`
- Priority for non-auth fields: profile → env → JDBC → CLI args (later wins)
- Priority for auth: CLI PAT > env PAT > profile PAT > CLI user/pass > JDBC user/pass > env user/pass > profile user/pass
- If PAT is set, clear username/password
- Environment variables: `CZ_PAT`, `CZ_USERNAME`, `CZ_PASSWORD`, `CZ_SERVICE`, `CZ_PROTOCOL`, `CZ_INSTANCE`, `CZ_WORKSPACE`, `CZ_SCHEMA`, `CZ_VCLUSTER`

- [ ] **Step 6: Implement sensitive data masking**

Port from Python `masking.py`. Exact same regex patterns and masking logic.

`packages/cz-cli/src/output/masking.ts`:

```typescript
const PHONE_PATTERN = /phone|mobile|tel|cellphone/i
const EMAIL_PATTERN = /email|e_mail/i
const PASSWORD_PATTERN = /password|passwd|secret|api_key|apikey/i
const IDCARD_PATTERN = /id_card|idcard|id_number|identity|ssn|national_id/i

function maskPhone(val: string): string {
  const digits = val.replace(/\D/g, "")
  if (digits.length >= 7) return digits.slice(0, 3) + "****" + digits.slice(-4)
  return "****"
}

function maskEmail(val: string): string {
  const at = val.lastIndexOf("@")
  if (at < 0) return "******"
  const local = val.slice(0, at)
  const domain = val.slice(at + 1)
  if (local.length > 1) return local[0] + "***@" + domain
  return "***@" + domain
}

function maskPassword(_val: string): string {
  return "******"
}

function maskIdcard(val: string): string {
  if (val.length >= 6) {
    return val.slice(0, 3) + "*".repeat(Math.max(val.length - 7, 1)) + val.slice(-4)
  }
  return "****"
}

type Masker = (val: string) => string

function getMasker(column: string): Masker | undefined {
  if (PHONE_PATTERN.test(column)) return maskPhone
  if (EMAIL_PATTERN.test(column)) return maskEmail
  if (PASSWORD_PATTERN.test(column)) return maskPassword
  if (IDCARD_PATTERN.test(column)) return maskIdcard
  return undefined
}

export function maskRows(
  columns: string[],
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const maskers = new Map<string, Masker>()
  for (const col of columns) {
    const m = getMasker(col)
    if (m) maskers.set(col, m)
  }
  if (maskers.size === 0) return rows
  for (const row of rows) {
    for (const [col, masker] of maskers) {
      if (typeof row[col] === "string") {
        row[col] = masker(row[col] as string)
      }
    }
  }
  return rows
}
```

- [ ] **Step 7: Implement output formatter**

Port from Python `output.py`. Implement all 6 formats: json, pretty, table, csv, jsonl, toon.

`packages/cz-cli/src/output/formatter.ts` — implement:
- `formatJson(data)` — compact JSON
- `formatPretty(data)` — indented JSON (2 spaces)
- `formatTable(columns, rows)` — ASCII table with column alignment
- `formatCsv(columns, rows)` — CSV with header row
- `formatJsonl(rows)` — one JSON object per line
- `formatToon(data)` — if toons library available, else fall back to JSON

`packages/cz-cli/src/output/index.ts` — implement:
- `success(data, opts)` — wraps in `{ok: true, data, time_ms, count, ai_message}`, prints, exits 0
- `successRows(columns, rows, opts)` — wraps in `{ok: true, columns, rows, count, affected, time_ms}`, prints, exits 0
- `error(code, message, opts)` — wraps in `{ok: false, error: {code, message}}`, prints, exits 1
- Exit codes: `EXIT_OK = 0`, `EXIT_BIZ_ERROR = 1`, `EXIT_USAGE_ERROR = 2`
- Color detection: respect `NO_COLOR`, `CZ_FORCE_COLOR`, `CLICOLOR_FORCE`, fallback to `isatty()`

- [ ] **Step 8: Implement operation logger**

Port from Python `logger.py`. Writes to `~/.clickzetta/sql-history.jsonl`.

`packages/cz-cli/src/logger.ts` — implement:
- `logOperation(command, opts)` — appends JSONL entry
- `redactSql(sql)` — redact sensitive literals in SQL (phone, idcard, email, passwords near sensitive column names)
- Regex patterns: same as Python version
- Silent failure on write errors
- Creates directory if needed

- [ ] **Step 9: Run `bun install` and verify compilation**

Run: `bun install && cd packages/cz-cli && bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add packages/cz-cli/
git commit -m "feat(cz-cli): scaffold package, connection config, output formatting, masking, logger"
```

---

## Task 6: Implement cz-cli yargs root and global options

**Files:**
- Create: `packages/cz-cli/src/cli.ts`
- Modify: `packages/cz-cli/src/index.ts`

- [ ] **Step 1: Implement yargs root with global options injection**

Port from Python `main.py` and `cli_group.py`. The root group auto-injects connection, output, and debug options into all subcommands.

`packages/cz-cli/src/cli.ts`:

```typescript
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { VERSION } from "./version.js"
import { resolveConnectionConfig } from "./connection/config.js"

export interface GlobalArgs {
  profile?: string
  jdbc?: string
  pat?: string
  username?: string
  password?: string
  service?: string
  protocol?: string
  instance?: string
  workspace?: string
  schema?: string
  vcluster?: string
  output: string
  debug: boolean
  silent: boolean
  verbose: boolean
}

export function createCli(args: string[]) {
  return yargs(args)
    .scriptName("cz-tool")
    .version(VERSION)
    .option("profile", {
      alias: "p",
      type: "string",
      describe: "Profile name from ~/.clickzetta/profiles.toml",
    })
    .option("jdbc", {
      type: "string",
      describe: "JDBC connection URL",
    })
    .option("pat", {
      type: "string",
      describe: "Personal Access Token",
    })
    .option("username", {
      type: "string",
      describe: "Username",
    })
    .option("password", {
      type: "string",
      describe: "Password",
    })
    .option("service", {
      type: "string",
      describe: "Service endpoint",
    })
    .option("protocol", {
      type: "string",
      describe: "Protocol (https/http)",
    })
    .option("instance", {
      type: "string",
      describe: "Instance name",
    })
    .option("workspace", {
      type: "string",
      describe: "Workspace name",
    })
    .option("schema", {
      alias: "s",
      type: "string",
      describe: "Default schema",
    })
    .option("vcluster", {
      alias: "v",
      type: "string",
      describe: "Virtual cluster",
    })
    .option("output", {
      alias: "o",
      type: "string",
      choices: ["json", "pretty", "table", "csv", "jsonl", "toon"],
      default: "json",
      describe: "Output format",
    })
    .option("debug", {
      alias: "d",
      type: "boolean",
      default: false,
      describe: "Enable debug mode",
    })
    .option("silent", {
      type: "boolean",
      default: false,
      describe: "Suppress non-essential output",
    })
    .option("verbose", {
      type: "boolean",
      default: false,
      describe: "Verbose output",
    })
    .strict()
    .fail((msg, err) => {
      const output = JSON.stringify({
        ok: false,
        error: { code: "USAGE_ERROR", message: msg || err?.message },
      })
      process.stderr.write(output + "\n")
      process.exit(2)
    })
}
```

- [ ] **Step 2: Create entry point**

`packages/cz-cli/src/index.ts`:

```typescript
#!/usr/bin/env bun
import { createCli } from "./cli.js"

const cli = createCli(process.argv.slice(2))

// Commands will be registered in subsequent tasks
// For now, just parse and show help
cli.demandCommand(1, "").help().parse()
```

- [ ] **Step 3: Verify it runs**

Run: `cd packages/cz-cli && bun src/index.ts --help`
Expected: Shows help with all global options listed.

- [ ] **Step 4: Commit**

```bash
git add packages/cz-cli/src/cli.ts packages/cz-cli/src/index.ts
git commit -m "feat(cz-cli): yargs root with global options"
```

---

## Task 7: Implement core CLI commands (sql, schema, table, workspace, status)

**Files:**
- Create: `packages/cz-cli/src/commands/sql.ts`
- Create: `packages/cz-cli/src/commands/schema.ts`
- Create: `packages/cz-cli/src/commands/table.ts`
- Create: `packages/cz-cli/src/commands/workspace.ts`
- Create: `packages/cz-cli/src/commands/status.ts`
- Modify: `packages/cz-cli/src/index.ts` (register commands)

- [ ] **Step 1: Implement sql command**

Port from Python `commands/sql.py`. This is the most complex command. Must include:
- All options: `--write`, `--with-schema`, `--no-truncate`, `-f`, `-e`, `--stdin`, `--sync`, `--timeout`, `--variable`, `--set`, `--job-profile`, `-N`, `--no-limit`, `-B`
- Safety guardrails: write protection (require `--write` for INSERT/UPDATE/DELETE/etc.), dangerous write detection (DELETE/UPDATE without WHERE), automatic LIMIT 100 injection
- Multi-statement support via `splitSql()`
- Variable substitution (`%(key)s` format)
- Sensitive data masking via `maskRows()`
- Async mode: submit and return job_id without waiting
- Field truncation (3000 chars default)
- Schema hints on error

Read `~/code/cz-cli/cz_cli/commands/sql.py` for the exact regex patterns:
- `_WRITE_RE`: matches INSERT, UPDATE, DELETE, REPLACE, ALTER, CREATE, DROP, TRUNCATE, RENAME, FORK
- `_SELECT_RE`: matches SELECT, SHOW, DESC, DESCRIBE, EXPLAIN
- `_LIMIT_RE`: matches existing LIMIT clause
- `_DANGEROUS_WRITE_RE`: DELETE/UPDATE without WHERE

- [ ] **Step 2: Implement schema command**

Port from Python `commands/schema.py`. Four subcommands using SQL queries:
- `list`: `SHOW SCHEMAS` + optional `LIKE '{pattern}'`, client-side limit
- `describe`: `SHOW SCHEMAS EXTENDED WHERE schema_name='{name}'` + `SHOW TABLES IN {name}`
- `create`: `CREATE SCHEMA {name}`
- `drop`: `DROP SCHEMA {name}`

- [ ] **Step 3: Implement table command**

Port from Python `commands/table.py`. Seven subcommands:
- `list`: `SHOW TABLES` + optional `IN {schema}` + `LIKE '{pattern}'` + `LIMIT {limit+1}` (probe for truncation)
- `describe`: `DESC TABLE {name}`
- `preview`: `SELECT * FROM {name} LIMIT {limit}`
- `stats`: `SELECT COUNT(*) as row_count FROM {name}`
- `history`: `SHOW TABLES HISTORY` + filters
- `create`: Execute raw DDL (inline or from file)
- `drop`: `DROP TABLE {name}`

- [ ] **Step 4: Implement workspace command**

Port from Python `commands/workspace.py`. Two subcommands:
- `current`: Execute `SELECT current_workspace()`, return `{workspace: name}`
- `use`: Set workspace via SDK hint `sdk.job.default.ns`, optional `--persist` to update profile TOML

- [ ] **Step 5: Implement status command**

Port from Python `main.py` status command:
- Execute `SELECT current_workspace()` and `SELECT current_schema()`
- Return `{ok, connected, workspace, schema, cli_version, time_ms}`
- Handle connection errors gracefully

- [ ] **Step 6: Register all commands in index.ts**

Update `packages/cz-cli/src/index.ts` to register sql, schema, table, workspace, status commands with the yargs CLI.

- [ ] **Step 7: Verify compilation**

Run: `cd packages/cz-cli && bunx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/cz-cli/src/commands/ packages/cz-cli/src/index.ts
git commit -m "feat(cz-cli): sql, schema, table, workspace, status commands"
```

---

## Task 8: Implement profile, task, runs, attempts, agent commands

**Files:**
- Create: `packages/cz-cli/src/commands/profile.ts`
- Create: `packages/cz-cli/src/commands/task.ts`
- Create: `packages/cz-cli/src/commands/runs.ts`
- Create: `packages/cz-cli/src/commands/attempts.ts`
- Create: `packages/cz-cli/src/commands/agent.ts`
- Create: `packages/cz-cli/src/commands/job.ts`
- Modify: `packages/cz-cli/src/index.ts` (register commands)

- [ ] **Step 1: Implement profile command**

Port from Python `commands/profile.py` and `commands/profile_bootstrap.py`. Subcommands:
- `list`: List profiles, mask secrets by default, `--show-secret` to reveal
- `detail`: Show full config for a profile
- `create`: Create profile with PAT or username/password auth, `--skip-verify` option, connection verification via `SELECT 1`
- `update`: Update a single profile field
- `delete`: Delete a profile
- `use`: Set default profile
- `discover`: Authenticate via Studio URL, discover regions/instances (port URL parsing logic from `profile_bootstrap.py`)
- `list-workspaces`: List workspaces for a region
- `render-command`: Generate `czcli profile create` command string

- [ ] **Step 2: Implement task command**

Port from Python `commands/task.py`. This is the largest command file. Uses Studio SDK (not SQL).

Group with subcommands:
- `list`: List tasks with pagination (`--page`, `--page-size`, `--parent`, `--like`, `--type`)
- `list-folders`: List folders with pagination
- `create`: Create task (`--type SQL|PYTHON|SHELL|SPARK|FLOW`, `--folder`, `--description`)
- `create-folder`: Create folder (`--parent`)
- `content`: Get task content by name or ID
- `save-content`: Save task script content
- `save-config`: Save task schedule configuration (cron, vc, schema, params)
- `deps`: Show task dependencies
- `execute`: Execute task ad-hoc
- `online`: Publish/online task
- `offline`: Take task offline

Flow subgroup (`task flow`):
- `dag`: Get flow DAG
- `create-node`: Add node to flow
- `remove-node`: Remove node
- `bind`: Create dependency between nodes
- `unbind`: Remove dependency
- `node-detail`: Get node content
- `node-save`: Save node script
- `node-save-config`: Save node config
- `submit`: Publish flow
- `instances`: List flow node instances

Helper functions to port:
- `_parse_task_type()`: Map string type to integer code
- `_resolve_folder_id_by_name()`: Search folders by name across pages
- `_normalize_cron_expression()`: Convert 5/6/7-field cron to 7-field

- [ ] **Step 3: Implement runs command**

Port from Python `commands/runs.py`. Subcommands:
- `list`: List runs with filters (`--task`, `--status`, `--run-type`, `--from`, `--to`, `--page`, `--page-size`, `--limit`)
- `detail`: Get run detail by ID
- `wait`: Poll until run completes (with timeout)
- `logs`: Get run logs (alias for attempts log)
- `deps`: View run dependencies
- `stop`: Stop running instance
- `stats`: Run statistics summary
- `refill`: Submit backfill job

Status/type mappings: `SUCCESS=1, WAITING=2, FAILED=3, RUNNING=4`, `SCHEDULE=1, TEMP=3, REFILL=4`

- [ ] **Step 4: Implement attempts command**

Port from Python `commands/attempts.py`. Two subcommands:
- `list`: List attempt records by run_id or task_name, auto-select latest run if not specified
- `log` (alias `logs`): Get attempt log with optional `--attempt-id` and `--offset`

- [ ] **Step 5: Implement agent command**

Port from Python `commands/agent.py`. Two subcommands:
- `status`: Check AI Agent health via `agentHealth()`
- `ask`: Send question, optional `--conversation-id` for multi-turn, `--agent-url`, `--token` overrides

- [ ] **Step 6: Implement job command**

Port from Python `commands/job.py`. Currently mostly commented out in Python — implement the framework with placeholder for future expansion.

- [ ] **Step 7: Register all commands in index.ts**

Update `packages/cz-cli/src/index.ts` to register profile, task, runs, attempts, agent, job commands.

- [ ] **Step 8: Verify compilation**

Run: `cd packages/cz-cli && bunx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 9: Commit**

```bash
git add packages/cz-cli/src/commands/ packages/cz-cli/src/index.ts
git commit -m "feat(cz-cli): profile, task, runs, attempts, agent, job commands"
```

---

## Task 9: Implement ai-guide, install-skills, and guide-builder

**Files:**
- Create: `packages/cz-cli/src/commands/ai-guide.ts`
- Create: `packages/cz-cli/src/commands/install-skills.ts`
- Create: `packages/cz-cli/src/guide-builder.ts`
- Modify: `packages/cz-cli/src/index.ts` (register commands)

- [ ] **Step 1: Implement guide-builder**

Port from Python `guide_builder.py`. Generates structured command reference for AI agents.

`packages/cz-cli/src/guide-builder.ts` — implement:
- `buildAiGuide(cli, options)`: Walk the yargs command tree, extract command names, descriptions, options, arguments
- `--wide` mode: include per-command option details
- Output structure: `{version, commands: [{name, description, options?, arguments?}]}`

- [ ] **Step 2: Implement ai-guide command**

Port from Python `main.py` ai-guide command.

`packages/cz-cli/src/commands/ai-guide.ts`:
- Options: `--wide` (include per-command options), `-f/--format` (default: toon)
- Calls `buildAiGuide()` and outputs in requested format
- Default format is `toon` (not `json`)

- [ ] **Step 3: Implement install-skills command**

Port from Python `commands/skills_installer.py`.

`packages/cz-cli/src/commands/install-skills.ts`:
- Options: `-g/--global`, `-y/--yes`, `--silent`
- Discover skills from bundled skills directory
- Target tools: Claude Code (`~/.claude/skills`), Cursor (`~/.cursor/skills`), Kiro, Codex, etc.
- Copy skill directories to target paths
- Interactive mode: prompt for tool and skill selection (use readline or simple stdin prompts)

- [ ] **Step 4: Register commands and verify**

Register ai-guide and install-skills in `packages/cz-cli/src/index.ts`.

Run: `cd packages/cz-cli && bunx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/cz-cli/src/
git commit -m "feat(cz-cli): ai-guide, install-skills commands, guide builder"
```

---

## Task 10: Modify opencode — rename, routing, cz-tool integration

**Files:**
- Modify: `packages/opencode/src/index.ts`
- Modify: `packages/opencode/src/cli/cmd/forward.ts`
- Modify: `packages/opencode/src/cli/cmd/tui/brand.ts`
- Modify: `packages/opencode/src/installation/index.ts`
- Delete: `packages/opencode/src/cli/cmd/profile.ts`
- Delete: `packages/opencode/src/profile/index.ts`
- Modify: `packages/opencode/package.json`

- [ ] **Step 1: Update brand.ts**

Change binary name from `czagent` to `czcli`:

```typescript
export const brand = {
  name: "czcli",
  display: "CZAgent",
  company: "ClickZetta",
}
```

- [ ] **Step 2: Update index.ts entry point**

Modify `packages/opencode/src/index.ts`:
- Change `.scriptName("czagent")` to `.scriptName("czcli")`
- Add `agent` as a command that wraps the current TUI/run logic
- Keep forward commands for non-agent subcommands (sql, task, runs, etc.)
- Remove profile command registration (now handled by cz-tool)
- Remove profile middleware check (cz-tool handles its own profile resolution)

- [ ] **Step 3: Update forward.ts**

Update `packages/opencode/src/cli/cmd/forward.ts`:
- `resolveCzTool()` should look for the new TS-compiled cz-tool binary at the same relative path (`{binDir}/cz-tool/cz-tool`)
- No other changes needed — the forwarding mechanism stays the same

- [ ] **Step 4: Clean up installation/index.ts**

Remove all Python cz-cli download/install logic from `packages/opencode/src/installation/index.ts`:
- Remove `downloadCzCli()` or equivalent functions
- Remove GitHub release fetching for cz-cli
- Remove PyInstaller binary extraction
- Keep any other installation logic (skills, config setup)

- [ ] **Step 5: Delete redundant profile code**

Delete:
- `packages/opencode/src/cli/cmd/profile.ts`
- `packages/opencode/src/profile/index.ts`
- `packages/opencode/src/profile/` directory

Remove imports and references to these files from `index.ts`.

- [ ] **Step 6: Add clickzetta-sdk dependency**

Update `packages/opencode/package.json` to add:
```json
"@clickzetta/sdk": "workspace:*"
```

This allows opencode to directly call SDK functions (e.g., for profile verification in the future).

- [ ] **Step 7: Verify compilation**

Run: `cd packages/opencode && bunx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/opencode/
git commit -m "refactor(opencode): rename to czcli, update routing, remove Python cz-cli deps"
```

---

## Task 11: Register cz-tool as opencode built-in tool

**Files:**
- Create: `packages/opencode/src/tool/cz-tool.ts`
- Modify: `packages/opencode/src/tool/registry.ts`

- [ ] **Step 1: Implement cz-tool tool definition**

Create `packages/opencode/src/tool/cz-tool.ts` following the existing tool pattern (Effect-based, Zod schema). Reference `packages/opencode/src/tool/bash.ts` for the exact pattern.

The tool should:
- Accept a `command` parameter (string, e.g., "sql -e 'SELECT 1'" or "table list")
- Accept optional `profile` parameter
- Spawn the cz-tool binary with the given command args
- Capture stdout/stderr
- Return structured output (parse JSON from cz-tool stdout)
- Use `--output json` to ensure machine-readable output
- Respect the agent's abort signal

Zod parameters schema:

```typescript
const Parameters = z.object({
  command: z.string().describe(
    "The cz-tool command to execute, e.g. 'sql -e \"SELECT 1\"' or 'table list --like users'"
  ),
  profile: z.string().optional().describe("Profile name to use"),
})
```

- [ ] **Step 2: Register in tool registry**

Modify `packages/opencode/src/tool/registry.ts`:
- Import the cz-tool definition
- Add it to the builtin tools array alongside bash, read, write, etc.

- [ ] **Step 3: Verify compilation**

Run: `cd packages/opencode && bunx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/tool/cz-tool.ts packages/opencode/src/tool/registry.ts
git commit -m "feat(opencode): register cz-tool as built-in tool for agent"
```

---

## Task 12: Update build system

**Files:**
- Modify: `packages/opencode/script/build.ts`
- Modify: `Makefile`
- Modify: `scripts/setup.sh`

- [ ] **Step 1: Update build.ts to compile cz-tool**

Modify `packages/opencode/script/build.ts`:
- Before compiling the main `czcli` binary, compile `packages/cz-cli/src/index.ts` into `cz-tool` binary using `Bun.build()` with `compile: true`
- Output to `dist/{platform}/bin/cz-tool/cz-tool`
- Remove the section that downloads Python cz-cli from GitHub releases
- Remove skills.tar.gz bundling (skills are now part of the TS package)

Build cz-tool:
```typescript
await Bun.build({
  entrypoints: ["../../cz-cli/src/index.ts"],
  outdir: `dist/${name}/bin/cz-tool`,
  compile: {
    target: name.replace(pkg.name, "bun"),
    outfile: `dist/${name}/bin/cz-tool/cz-tool`,
  },
  define: {
    CZ_TOOL_VERSION: `'${Script.version}'`,
  },
})
```

- [ ] **Step 2: Update Makefile**

Update the `build` target to:
- Remove Python cz-cli download step
- The Bun build now produces both `czcli` and `cz-tool` binaries
- Update output binary name from `czcode` to `czcli`
- Update zip/tar naming

- [ ] **Step 3: Update setup.sh**

Modify `scripts/setup.sh`:
- Install `czcli` binary to `~/.local/bin/czcli`
- Create symlinks: `cz` → `czcli`, `cz-cli` → `czcli`, `clickzetta-cli` → `czcli`
- Install `cz-tool` to `~/.local/bin/cz-tool/cz-tool` (or alongside czcli)
- Remove Python cz-cli installation steps
- Remove `pip install` or PyInstaller binary extraction
- Keep skills installation and config setup

- [ ] **Step 4: Test build locally**

Run: `make build`
Expected: Produces `czcli` and `cz-tool` binaries in `out/` directory.

- [ ] **Step 5: Smoke test**

Run: `./out/czcli-darwin-arm64/czcli --version`
Expected: Shows version.

Run: `./out/czcli-darwin-arm64/czcli sql --help`
Expected: Shows SQL command help (forwarded to cz-tool).

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/script/build.ts Makefile scripts/setup.sh
git commit -m "build: compile cz-tool from TS, remove Python cz-cli bundling"
```

---

## Task 13: End-to-end verification

**Files:** None (testing only)

- [ ] **Step 1: Verify cz-tool standalone**

Run: `cd packages/cz-cli && bun src/index.ts --help`
Expected: Shows all commands and global options.

Run: `cd packages/cz-cli && bun src/index.ts status --profile <test-profile>`
Expected: Shows connection status or appropriate error.

- [ ] **Step 2: Verify czcli routing**

Run: `cd packages/opencode && bun src/index.ts sql --help`
Expected: Forwards to cz-tool, shows SQL help.

Run: `cd packages/opencode && bun src/index.ts agent --help`
Expected: Shows opencode agent help (TUI, run, etc.).

- [ ] **Step 3: Verify profile operations**

Run: `cd packages/cz-cli && bun src/index.ts profile list`
Expected: Lists profiles from `~/.clickzetta/profiles.toml`.

- [ ] **Step 4: Verify SQL execution (if test profile available)**

Run: `cd packages/cz-cli && bun src/index.ts sql -e "SELECT 1" --profile <test-profile>`
Expected: Returns `{ok: true, columns: [...], rows: [{...}], count: 1}`.

- [ ] **Step 5: Verify output formats**

Run: `cd packages/cz-cli && bun src/index.ts profile list --output pretty`
Run: `cd packages/cz-cli && bun src/index.ts profile list --output table`
Run: `cd packages/cz-cli && bun src/index.ts profile list --output csv`
Expected: Each format renders correctly.

- [ ] **Step 6: Verify cz-tool as opencode tool**

Start opencode TUI, ask the agent to "list my ClickZetta tables". Verify it invokes the cz-tool built-in tool.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: complete cz-cli TypeScript rewrite — eliminate Python dependency"
```
