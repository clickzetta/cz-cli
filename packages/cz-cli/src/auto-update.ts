export async function checkAndUpdate(args: string[]): Promise<void> {
  const module = await import("./bootstrap/update.js") as {
    maybeAutoUpdate: (input: { args: string[] }) => Promise<void>
  }
  await module.maybeAutoUpdate({ args })
}
