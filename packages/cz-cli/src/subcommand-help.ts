// Sentinel thrown by a command group's fail handler after it has already
// rendered that group's help for a bare (missing-subcommand) invocation.
//
// Why throw at all: yargs marks the parse as failed on a demandCommand miss. If
// the fail handler merely returns, yargs bubbles the same failure up to every
// ancestor fail handler (which would re-emit USAGE_ERROR) and then runs the
// post-validation middleware (which would emit NO_PROFILE). Throwing a sentinel
// stops the bubble immediately and aborts the pipeline before that middleware —
// so a bare group prints help, never USAGE_ERROR or NO_PROFILE.
//
// The help itself is rendered inline in the fail handler from the failing yargs
// instance (yargs hands it to the handler as the 3rd argument), so the sentinel
// carries no data. Each parse boundary (run-cli, execute, opencode main /
// config-llm) simply catches it and exits 0 — help is already on stdout.
//
// Kept in its own leaf module (no imports) so command-group.ts, cli.ts,
// run-cli.ts and execute.ts can all import it without an import cycle, and so
// command-group.ts can re-export it for the opencode agent runtime.
export class SubcommandHelpShown extends Error {
  constructor() {
    super("subcommand help shown")
    this.name = "SubcommandHelpShown"
  }
}
