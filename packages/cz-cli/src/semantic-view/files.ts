import path from "node:path"
import { mkdir, open, rename, unlink } from "node:fs/promises"
import { SemanticViewError } from "./error.js"
import { fingerprint } from "./metadata.js"

export function workspaceFile(file?: string, name = "model") {
  if (file && path.isAbsolute(file)) return file
  if (file?.split(/[\\/]/)[0] === "cz_project") return path.resolve(file)
  return path.resolve("cz_project", file ?? `${name}.sv.yaml`)
}

export async function atomicWrite(file: string, content: string) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${crypto.randomUUID()}.tmp`
  const handle = await open(temp, "wx", 0o600)
  try {
    await handle.writeFile(content)
    await handle.sync()
    await handle.close()
    await rename(temp, file)
  } finally {
    await handle.close().catch(() => {})
    await unlink(temp).catch(() => {})
  }
  return { path: file, fingerprint: fingerprint(content) }
}

export async function withFileLock<T>(file: string, fn: () => Promise<T>) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const handle = await open(file + ".lock", "wx", 0o600).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "EEXIST")
      throw new SemanticViewError(
        "LOCKED",
        `Another operation owns ${file}.lock; inspect its owner before removing a stale lock`,
      )
    throw e
  })
  await handle.writeFile(JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }))
  try {
    return await fn()
  } finally {
    await handle.close()
    await unlink(file + ".lock")
  }
}
