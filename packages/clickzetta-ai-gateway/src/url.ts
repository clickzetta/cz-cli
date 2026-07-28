export function normalizeClickzettaGatewayUrl(url: string) {
  const trimmed = url.replace(/\/+$/, "")
  if (/\/gateway\/v\d+$/.test(trimmed)) return trimmed
  if (/\/gateway$/.test(trimmed)) return `${trimmed}/v1`

  const version = trimmed.match(/\/v(\d+)$/)
  if (version) return `${trimmed.slice(0, -version[0].length)}/gateway/v${version[1]}`
  return `${trimmed}/gateway/v1`
}
