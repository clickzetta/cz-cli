/**
 * A usage error raised by our OWN validation (as opposed to yargs' built-in
 * checks, which reach the fail handler as a plain message with no error object).
 *
 * Both fail handlers — cli.ts's and commandGroup's — rethrow any error they are
 * handed, so that a genuine exception from a command handler is never disguised
 * as a usage error. A validator that wants the USAGE_ERROR treatment therefore
 * needs to be distinguishable from such an exception: that is this class, and
 * the two handlers special-case it.
 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UsageError"
  }
}
