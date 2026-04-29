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
