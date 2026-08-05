// cz_change: the ONE list of DNS suffixes that belong to ClickZetta.
//
// This exists because the list was duplicated and then drifted. Five places
// independently decided "is this host ours?" — clickzetta-provider.ts,
// clickzetta-gateway-host.ts, clickzetta-mcp.ts, commands/account-login.ts and
// commands/setup.ts — and four of them accepted `singdata.com` (the intl
// partition) while isClickzettaGatewayUrl accepted only `clickzetta.com`.
//
// The consequence was invisible and severe: an llm.json entry declared as a
// generic `@ai-sdk/openai-compatible` provider is only recognized as ClickZetta
// by sniffing its baseURL (see entryFromProvider in native-config.ts), so intl
// users' entries failed that test and the TUI quota indicator rendered nothing at
// all — no token quota AND no cash balance. Chat kept working, because chat uses
// the api_key directly and never consults this, which made the failure look
// unrelated to configuration.
//
// So: add a partition here, not at the call sites. A sixth copy is the bug.

/** DNS suffixes owned by ClickZetta, including the intl (`singdata.com`) partition. */
export const CLICKZETTA_HOST_SUFFIXES = [".clickzetta.com", ".singdata.com", ".clickzetta-inc.com"] as const

/**
 * Whether `host` is a ClickZetta-owned host. Matches a suffix or the apex domain
 * itself (`clickzetta.com` as well as `x.clickzetta.com`). Case-insensitive;
 * callers pass hostnames from URLs and from config, which differ in casing.
 */
export function isClickzettaHost(host: string | undefined): boolean {
  if (!host) return false
  const value = host.toLowerCase()
  return CLICKZETTA_HOST_SUFFIXES.some((suffix) => value === suffix.slice(1) || value.endsWith(suffix))
}
