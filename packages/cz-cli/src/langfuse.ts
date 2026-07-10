let langfuseInstance: any | undefined
let enabled = false

export async function initLangfuse() {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY
  const secretKey = process.env.LANGFUSE_SECRET_KEY
  if (!publicKey || !secretKey) return

  try {
    const { Langfuse } = await import("langfuse")
    langfuseInstance = new Langfuse({
      publicKey,
      secretKey,
      baseUrl: process.env.LANGFUSE_BASEURL || process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com",
    })
    enabled = true
  } catch {}
}

export async function flushLangfuse() {
  if (!enabled || !langfuseInstance) return
  try {
    await langfuseInstance.flushAsync()
  } catch {}
}
