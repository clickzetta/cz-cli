import { execute } from "../execute.js"

export async function forward(args: readonly string[]): Promise<never> {
  // Pass argv through execute()'s extraArgs verbatim rather than serializing to a
  // shell string and re-splitting. The round-trip was lossy: empty-string args
  // ("") vanished and backslash-only args (Windows paths, regex) were mangled by
  // splitArgs. extraArgs is appended after splitArgs(), so an empty command string
  // yields exactly the argv we were given.
  const result = await execute("", [...args])
  process.stdout.write(result.output)
  process.exit(result.exitCode)
}
