import { DEFAULT_CONNECTION, forceRefreshToken, getToken } from "@clickzetta/sdk"
import { makeProfileTokenStore, updateProfiles } from "../../src/connection/profile-store.js"
import { refreshOAuthToken } from "../../src/connection/oauth-state.js"
import { writeFileSync } from "node:fs"

const [home, issuer, mode, profile = "p"] = process.argv.slice(2)
process.env.CLICKZETTA_TEST_HOME = home
const store = makeProfileTokenStore(profile)
// Exercise pending/crashed owners without spending the production wait budget.
store.refresh = (previous, request) => refreshOAuthToken(previous, request, 200)
const config = {
  ...DEFAULT_CONNECTION,
  pat: mode === "fallback" ? "test-pat" : "",
  service: issuer,
  protocol: "http",
  instance: "test",
  cacheKey: profile,
  tokenStore: store,
}

try {
  if (mode === "edit") {
    updateProfiles((profiles) => {
      writeFileSync(`${home}/editing`, "")
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2500)
      profiles.p.workspace = "edited"
    })
    console.log(JSON.stringify({ edited: true }))
  } else if (mode === "crash-before-send") {
    await store.refresh(store.load()!, async () => process.exit(71))
  } else {
    const token = mode === "force" ? await forceRefreshToken(config, "a0") : await getToken(config)
    console.log(JSON.stringify({ token: token.token, persisted: store.load()?.token }))
  }
} catch (error) {
  console.log(JSON.stringify({ code: (error as { code?: string }).code, message: String(error) }))
}
