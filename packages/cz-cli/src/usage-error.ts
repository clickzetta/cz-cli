/** Recognize yargs arity diagnostics, never errors forwarded without a parser message. */
export function isParserError(error: Error, message: string | undefined): boolean {
  return error.name === "YError" && message === error.message &&
    /^Not enough arguments following: .+/.test(message)
}

/** An explicit usage error raised by our own command validation. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UsageError"
  }
}
