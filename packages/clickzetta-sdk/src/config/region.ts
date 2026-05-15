export function detectEnv(service: string): string {
  const host = service.replace("https://", "").replace("http://", "").split("/")[0] ?? ""
  if (host.startsWith("dev-api.")) return "dev"
  if (host.startsWith("sit-api.")) return "sit"
  if (host.startsWith("uat-api.")) return "uat"
  if (host === "api.clickzetta.com" || host === "api.singdata.com") return "prod"
  const czMatch = host.match(/^([^.]+)\.api\.clickzetta\.com/)
  if (czMatch) return czMatch[1]
  const sgMatch = host.match(/^([^.]+)\.api\.singdata\.com/)
  if (sgMatch) return sgMatch[1]
  // For custom/enterprise domains, return "prod" as default (matching Python's fallback)
  return "prod"
}

export function toServiceUrl(service: string, protocol: string = "https"): string {
  if (service.startsWith("https://") || service.startsWith("http://")) {
    return service.replace(/\/+$/, "")
  }
  const proto = protocol.toLowerCase()
  return `${proto === "http" ? "http" : "https"}://${service}`
}
