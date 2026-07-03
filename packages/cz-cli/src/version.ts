// CLICKZETTA_VERSION is injected at build time via `define` in build.ts.
// At dev time (bun run) it's undefined, so we fall back to a local timestamp.
declare const CLICKZETTA_VERSION: string | undefined
const ts = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")
export const VERSION = typeof CLICKZETTA_VERSION === "string" ? CLICKZETTA_VERSION : `0.0.0-dev+${ts}`
