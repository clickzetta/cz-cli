// cz_change: ClickZetta binary bootstrap. The compiled `cz-cli` binary starts
// here (packages/cz-cli/script/build.ts vendors the opencode build pipeline and points it at this file).
// Runs restart-args + auto-update, then hands off to the cz runtime which owns
// the branded CLI and command routing.
// env-shim MUST be first — it mirrors CLICKZETTA_* → OPENCODE_* env before any
// opencode module (whose flag getters read process.env) is evaluated.
import "./env-shim"
import { restartArgs, maybeAutoUpdate } from "./update"
import { main } from "./runtime"

const args = restartArgs(process.execPath, process.argv)

await maybeAutoUpdate({ args })

process.exit(await main(args))
