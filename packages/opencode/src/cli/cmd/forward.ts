import { execute } from "@clickzetta/cli"

export async function forward(args: readonly string[]): Promise<never> {
  const command = args.join(" ")
  const result = await execute(command)
  process.stdout.write(result.output)
  process.exit(result.exitCode)
}
