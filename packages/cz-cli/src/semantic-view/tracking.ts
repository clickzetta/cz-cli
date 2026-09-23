import { z } from "zod"
import { atomicWrite } from "./files.js"

const Manifest = z
  .object({
    version: z.literal(1),
    file: z.string(),
    fqn: z.string().optional(),
    profile: z.string().optional(),
    identity: z.string().optional(),
    remote_fingerprint: z.string().optional(),
    local_fingerprint: z.string(),
    remote_version: z.string().optional(),
    state: z.enum(["draft", "downloaded", "edited", "deployed"]),
    updated_at: z.string(),
  })
  .strict()
export type Tracking = z.infer<typeof Manifest>
export async function readTracking(file: string) {
  const entry = Bun.file(file + ".manifest.json")
  if (!(await entry.exists())) return undefined
  return Manifest.parse(await entry.json())
}
export async function trackFile(file: string, update: Omit<Tracking, "version" | "file" | "updated_at">) {
  const manifest = Manifest.parse({ ...update, version: 1, file, updated_at: new Date().toISOString() })
  await atomicWrite(file + ".manifest.json", JSON.stringify(manifest, null, 2) + "\n")
  return { manifest_file: file + ".manifest.json", tracking: manifest }
}
