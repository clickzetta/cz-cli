export async function checkAndUpdate(args: string[]): Promise<void> {
  const module = await import(new URL("../../opencode/src/update/bootstrap.ts", import.meta.url).href) as {
    maybeAutoUpdate: (input: { args: string[] }) => Promise<void>
  }
  await module.maybeAutoUpdate({ args })
}
