declare global {
  const CLICKZETTA_VERSION: string
  const CLICKZETTA_CHANNEL: string
}

export const InstallationVersion = typeof CLICKZETTA_VERSION === "string" ? CLICKZETTA_VERSION : "local"
export const InstallationChannel = typeof CLICKZETTA_CHANNEL === "string" ? CLICKZETTA_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
