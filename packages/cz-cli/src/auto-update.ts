export async function checkAndUpdate(args: string[]): Promise<void> {
  const modulePath = new URL("../../opencode/src/update/bootstrap.ts", import.meta.url).pathname
  const module = await import(modulePath) as {
    maybeAutoUpdate: (input: { args: string[] }) => Promise<void>
  }
  await module.maybeAutoUpdate({ args })
}
