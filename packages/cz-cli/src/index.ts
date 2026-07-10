export { VERSION } from "./version.js"
export { runCli, runCliWithTracking } from "./run-cli.js"
export { trackCommand, isSensitiveKey, parseTrackingArgs } from "./telemetry.js"
export { commandGroup } from "./command-group.js"
export { resolveConnectionConfig } from "./connection/config.js"
export { parseJdbcUrl } from "./connection/jdbc.js"
export { loadProfiles, saveProfiles, getDefaultProfileName, getProfileConfig } from "./connection/profile-store.js"
export { maskRows } from "./output/masking.js"
export { success, successRows, error, shouldColorize, EXIT_OK, EXIT_BIZ_ERROR, EXIT_USAGE_ERROR } from "./output/index.js"
export type { OutputOptions } from "./output/index.js"
export type { CliArgs } from "./connection/config.js"
export { formatJson, formatPretty, formatTable, formatCsv, formatJsonl, formatToon } from "./output/formatter.js"
export { logOperation, redactSql } from "./logger.js"
export { formatBillingError, isBillingError } from "./commands/billing-error.js"
export { createCli } from "./cli.js"
export type { GlobalArgs } from "./cli.js"
export {
  CLICKZETTA_PROFILE_DESCRIPTION,
  CLICKZETTA_PROFILE_OPTION,
  CLICKZETTA_PROFILE_OPTION_NAMES,
  withClickZettaProfileOption,
} from "./clickzetta-profile-option.js"
export { execute, type ExecuteResult } from "./execute.js"
export { registerSetupCommand } from "./commands/setup.js"
export {
  CLICKZETTA_ROTATION_CANCEL_LABEL,
  CLICKZETTA_ROTATION_CONFIRM_LABEL,
  CLICKZETTA_ROTATION_HEADER,
  CLICKZETTA_ROTATION_PROMPT,
  inferAiGatewayUrl,
  isClickzettaQuotaExhausted,
  maybeRotateExhaustedClickzettaLlm,
  rotateClickzettaLlm,
  type ClickZettaRotationResult,
} from "./llm/clickzetta-rotation.js"
