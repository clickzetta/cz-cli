import { extractRootDomain, serviceEnvFromApiHost, splitEndpoint } from "../commands/account-login"

function stripTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "")
}

// Derive the accounts login-site base URL for a given service host.
// Precedence: CZ_OAUTH_ACCOUNTS_URL override → derive from service host.
// prod → https://accounts.<rootDomain>; dev/sit/uat → https://<env>-accounts.<rootDomain>.
export function accountsBaseUrl(service: string): string {
  const override = process.env.CZ_OAUTH_ACCOUNTS_URL
  if (override?.trim()) return stripTrailingSlash(override)

  const host = splitEndpoint(service).host
  const rootDomain = extractRootDomain(host)
  const env = serviceEnvFromApiHost(host)
  return env ? `https://${env}-accounts.${rootDomain}` : `https://accounts.${rootDomain}`
}
