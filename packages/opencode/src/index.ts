import { restartArgs, maybeAutoUpdate } from "./update/bootstrap"
import { main } from "./main"

const args = restartArgs(process.execPath, process.argv)

await maybeAutoUpdate({ args })

process.exit(await main(args))
