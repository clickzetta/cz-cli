import { DEFAULT_CONNECTION, forceRefreshToken, getToken } from "@clickzetta/sdk"
import { getProfileConfig, makeProfileTokenStore } from "../../src/connection/profile-store.js"

const config = {
  ...DEFAULT_CONNECTION,
  ...getProfileConfig(process.argv[2]),
  tokenStore: makeProfileTokenStore(process.argv[2]),
  cacheKey: "session",
}
process.on("message", async (command: { force?: boolean; rejected?: string }) => {
  try {
    const token = command.force ? await forceRefreshToken(config, command.rejected) : await getToken(config)
    process.send?.({ token })
  } catch (error) {
    process.send?.({ error: error instanceof Error ? error.message : String(error) })
  }
})
process.send?.({ ready: true })
