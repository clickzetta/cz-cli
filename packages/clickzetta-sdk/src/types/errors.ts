/**
 * DB-API-style exception hierarchy for the ClickZetta TS SDK.
 *
 * Mirrors `clickzetta/connector/v0/exceptions.py` so callers can
 * catch the same categories as the Python connector. The existing
 * `ClickZettaApiError` (see `./api.ts`) is preserved for backwards
 * compatibility and is rewired to extend `OperationalError`.
 */

export interface ClickZettaErrorInit {
  /** Transport-level code, e.g. "HTTP_500", "PARSE_ERROR", "AUTH_FAILED". */
  code?: string
  /** HTTP status code, when known. */
  statusCode?: number
  /** Lakehouse business error code (CZLH-xxxxx). */
  errorCode?: string
  /** Job id the error is associated with, when applicable. */
  jobId?: string
}

export class ClickZettaError extends Error {
  code?: string
  statusCode?: number
  errorCode?: string
  jobId?: string

  constructor(message: string, init: ClickZettaErrorInit = {}) {
    super(message)
    this.name = "ClickZettaError"
    this.code = init.code
    this.statusCode = init.statusCode
    this.errorCode = init.errorCode
    this.jobId = init.jobId
  }
}

/** Protocol / connection / auth-layer failures. */
export class InterfaceError extends ClickZettaError {
  constructor(message: string, init: ClickZettaErrorInit = {}) {
    super(message, init)
    this.name = "InterfaceError"
  }
}

/** Base for errors reported by the database. */
export class DatabaseError extends ClickZettaError {
  constructor(message: string, init: ClickZettaErrorInit = {}) {
    super(message, init)
    this.name = "DatabaseError"
  }
}

/** Database runtime / network failure. Mirrors Python's OperationalError. */
export class OperationalError extends DatabaseError {
  constructor(message: string, init: ClickZettaErrorInit = {}) {
    super(message, init)
    this.name = "OperationalError"
  }
}

/** SQL syntax / parameter / usage error. */
export class ProgrammingError extends DatabaseError {
  constructor(message: string, init: ClickZettaErrorInit = {}) {
    super(message, init)
    this.name = "ProgrammingError"
  }
}

/** Data validation / coercion failure. */
export class DataError extends DatabaseError {
  constructor(message: string, init: ClickZettaErrorInit = {}) {
    super(message, init)
    this.name = "DataError"
  }
}

/** Integrity constraint violation. */
export class IntegrityError extends DatabaseError {
  constructor(message: string, init: ClickZettaErrorInit = {}) {
    super(message, init)
    this.name = "IntegrityError"
  }
}

/** Requested operation is not supported by the server or SDK. */
export class NotSupportedError extends DatabaseError {
  constructor(message: string, init: ClickZettaErrorInit = {}) {
    super(message, init)
    this.name = "NotSupportedError"
  }
}

/**
 * exception.py:29-32 ClickzettaJobNotExistsException — raised when a job id
 * does not exist on the server (lh_code CZLH-60005 / JOB_NOT_EXISTS).
 * Extends ProgrammingError because the caller supplied an invalid job id.
 */
export class JobNotExistsError extends ProgrammingError {
  constructor(message: string, init: ClickZettaErrorInit = {}) {
    super(message, init)
    this.name = "JobNotExistsError"
  }
}

export interface RawErrorInput {
  code?: string
  statusCode?: number
  errorCode?: string
  message?: string
  jobId?: string
}

/**
 * Map a raw transport/business error into the appropriate
 * {@link ClickZettaError} subclass. Classification rules:
 *
 * - HTTP 400 / 404 / 422 → ProgrammingError
 * - HTTP 401 / 403       → InterfaceError
 * - HTTP 5xx             → OperationalError
 * - lh_code CZLH-60010   → OperationalError (timeout)
 * - lh_code CZLH-60005   → ProgrammingError (job not found)
 * - fallback             → OperationalError
 */
export function toClickZettaError(raw: RawErrorInput): ClickZettaError {
  const message = raw.message ?? ""
  const init: ClickZettaErrorInit = {
    code: raw.code,
    statusCode: raw.statusCode,
    errorCode: raw.errorCode,
    jobId: raw.jobId,
  }

  // lh_code takes precedence over generic HTTP status when present.
  if (raw.errorCode === "CZLH-60010") {
    return new OperationalError(message, init)
  }
  if (raw.errorCode === "CZLH-60005") {
    return new JobNotExistsError(message, init)
  }

  const status = raw.statusCode
  if (status !== undefined) {
    if (status === 400 || status === 404 || status === 422) {
      return new ProgrammingError(message, init)
    }
    if (status === 401 || status === 403) {
      return new InterfaceError(message, init)
    }
    if (status >= 500 && status < 600) {
      return new OperationalError(message, init)
    }
  }

  if (raw.errorCode) {
    return new OperationalError(message, init)
  }

  return new OperationalError(message, init)
}
