export function detectEnv(service: string): string {
  const host = service.replace("https://", "").replace("http://", "")
  if (host.startsWith("dev-api.")) return "dev"
  if (host.startsWith("sit-api.")) return "sit"
  if (host.startsWith("uat-api.")) return "uat"
  const czMatch = host.match(/^([^.]+)\.api\.clickzetta\.com/)
  if (czMatch) return czMatch[1]
  const sgMatch = host.match(/^([^.]+)\.api\.singdata\.com/)
  if (sgMatch) return sgMatch[1]
  return "prod"
}

export function toServiceUrl(service: string, protocol: string = "https"): string {
  if (service.startsWith("https://") || service.startsWith("http://")) return service
  const proto = protocol.toLowerCase()
  return `${proto === "http" ? "http" : "https"}://${service}`
}
