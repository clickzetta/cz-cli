import { OperationalError } from "./errors.js"

export interface ApiResponse<T = unknown> {
  code: number | string
  message?: string
  msg?:string
  count?: number
  pageIndex?:number
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

/**
 * Legacy transport error retained for backwards compatibility.
 * Now extends OperationalError so callers using the new DB-API-style
 * hierarchy (see `./errors.ts`) will still match this class.
 */
export class ClickZettaApiError extends OperationalError {
  constructor(
    code: string,
    message: string,
    statusCode?: number,
  ) {
    super(message, { code, statusCode })
    this.name = "ClickZettaApiError"
    // Preserve the public `code` / `statusCode` fields expected by
    // existing call sites (they were already on OperationalError).
    this.code = code
    this.statusCode = statusCode
  }
}
