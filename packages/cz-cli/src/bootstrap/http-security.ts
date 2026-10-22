import { createSafeFetch } from "./http-fetch"

// Install before the CLI/module graph captures fetch. Each Worker has its own
// global object and installs the same boundary through bootstrap/worker.ts.
if (typeof Bun !== "undefined") globalThis.fetch = createSafeFetch(globalThis.fetch)
