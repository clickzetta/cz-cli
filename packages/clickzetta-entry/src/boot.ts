// cz_change: ClickZetta binary entrypoint. The compiled `cz-cli` binary starts
// here (build.ts points its entrypoint at this file via OPENCODE_BUILD_ENTRYPOINT).
// Depends one-way on opencode (opencode never imports this package). Runs
// restart-args + auto-update, then hands off to the cz `main()` which owns the
// cz-branded CLI and command routing.
// env-shim MUST be first — it mirrors CLICKZETTA_* → OPENCODE_* env before any
// opencode module (whose flag getters read process.env) is evaluated.
import "./env-shim"
import { restartArgs, maybeAutoUpdate } from "opencode/update/bootstrap"
import { main } from "./main"

const args = restartArgs(process.execPath, process.argv)

await maybeAutoUpdate({ args })

process.exit(await main(args))
