import { describe as bunDescribe } from "bun:test"

/**
 * Gate for live integration tests that require a real ClickZetta account:
 * a configured `~/.clickzetta/profiles.toml`, network access, and compute-capable
 * resources (datasources, tasks, runs). These cannot pass in a hermetic CI run,
 * so they are skipped unless `CZ_CLI_LIVE` is set.
 *
 * Usage — replace the `describe` import in a live test file:
 *
 *   import { liveDescribe as describe } from "./support/live.js"
 *   import { test, expect } from "bun:test"
 *
 * Run them explicitly with real credentials:
 *
 *   CZ_CLI_LIVE=1 bun test test/datasource.test.ts
 */
export const IS_LIVE = !!process.env.CZ_CLI_LIVE

export const liveDescribe: typeof bunDescribe = IS_LIVE
  ? bunDescribe
  : (bunDescribe.skipIf(true) as typeof bunDescribe)
