// cz_change: single bundling entry for the quota indicator's non-JSX halves.
//
// tui-quota.tsx ships as raw .tsx (the host must compile it so solid binds to the
// host singleton), so its imports have to resolve at runtime next to it in
// dist/*/bin/. Rather than copy three source files and hope their own relative
// imports line up, everything non-JSX is bundled behind this one entry — which is
// also why the renderer imports from here and not from the individual modules.
//
// Bun resolves the `./tui-quota-runtime.js` specifier to this .ts in a source
// checkout and to the pre-bundled .js in a compiled build, so one specifier
// serves both. Nothing here may import @opentui or solid-js.
export {
  fetchQuotaSnapshot,
  isPortalOk,
  maskApiKey,
  fetchProfileUserName,
  matchKeyUsage,
  readProfileInfo,
  readRecentProviders,
  resolveClickzettaEntry,
  selectDisplayedProvider,
  type ProfileInfo,
  type QuotaPeriod,
  type QuotaSnapshot,
} from "./tui-quota-data.js"

export {
  abbreviate,
  cashTone,
  formatCash,
  formatPercentLeft,
  periodSuffix,
  profileRows,
  quotaRows,
  quotaTone,
  remainingRatio,
  type QuotaRow,
  type QuotaTone,
} from "./tui-quota-format.js"

export { createQuotaController, type QuotaController, type QuotaControllerInput } from "./tui-quota-controller.js"

// cz_change: the gateway billing/quota prompt rides this same bundle. It is not
// quota-indicator code, but it has the same constraints (plain .ts, no @opentui,
// consumed by a raw .tsx renderer) and adding a second bundling entry would mean
// a second build asset plus installer-list churn for one module.
export {
  browserOpenCommandForPlatform,
  classifyGatewayError,
  gatewayErrorFields,
  planGatewayNotice,
  type GatewayNoticeAction,
  type GatewayNoticePlan,
} from "./gateway-prompt.js"

// cz_change: the quota-exhausted dialog mints a key on confirm, so the renderer
// needs the provisioning helper from this same bundle (it cannot import
// src/ directly — see the bundling note above).
export { provisionKeyForEntry, gatewayAliasForEntry, type KeyProvisionResult } from "../llm/key-provision.js"

// cz_change: the active provider/model context. Both renderers in this bundle need
// it — the quota indicator to know whose key to measure, the quota-exhausted notice
// to know whose key to replace — and they must agree, so it ships as one module
// rather than one answer per consumer.
export {
  createActiveModelContext,
  currentSessionID,
  type ActiveModelContext,
} from "./active-model.js"
