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
  matchKeyUsage,
  readRecentProviders,
  resolveClickzettaEntry,
  selectDisplayedProvider,
  type QuotaPeriod,
  type QuotaSnapshot,
} from "./tui-quota-data.js"

export {
  abbreviate,
  cashTone,
  formatCash,
  periodLabel,
  quotaSegments,
  quotaTone,
  remainingRatio,
  type QuotaSegment,
  type QuotaTone,
} from "./tui-quota-format.js"

export { createQuotaController, type QuotaController, type QuotaControllerInput } from "./tui-quota-controller.js"
