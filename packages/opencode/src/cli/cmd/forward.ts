import { execute } from "@clickzetta/cli"

export async function forward(args: readonly string[]): Promise<never> {
  const command = args.map(a => /[\s"']/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a).join(" ")
  const result = await execute(command)
  process.stdout.write(result.output)
  process.exit(result.exitCode)
}
