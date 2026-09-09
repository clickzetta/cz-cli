export async function checkAndUpdate(args: string[]): Promise<void> {
  const { maybeAutoUpdate } = await import("./bootstrap/update.js")
  const { InstallationVersion } = await import("@opencode-ai/core/installation/version")
  await maybeAutoUpdate({ args, version: InstallationVersion })
}
