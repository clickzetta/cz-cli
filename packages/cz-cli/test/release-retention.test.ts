import { expect, test } from "bun:test"
import path from "node:path"
import { retainedVersionHistory, retentionCleanup } from "../../../scripts/cos-release.mjs"
const version = "dev-v1.17.11.20261109170000"
const control = path.resolve(import.meta.dir, "../../..")
test("nightly retention cannot evict stable history or artifacts", async () => {
  const stable = [
    { version: "1.1.0", released_at: "old", channel_tags: ["stable"], extra: "preserve" },
    { version: "1.0.0", channel_tags: [] },
  ]
  const existing = {
    stable: "1.1.0",
    nightly: "dev-v1.1.0.old",
    versions: [stable[0], { version: "dev-v1.1.0.old", channel_tags: ["nightly"] }, stable[1]],
  }
  const history = retainedVersionHistory({ version, buildDate: "now", retain: 1 }, ["nightly"], existing)
  expect(history).toEqual([{ version, released_at: "now", channel_tags: ["nightly"] }, ...stable])
  expect(history.filter((entry: { version: string }) => !entry.version.startsWith("dev-v"))).toEqual(stable)
  expect(existing.stable).toBe("1.1.0")
  expect(existing.versions[0]).toBe(stable[0])
  await expect(retentionCleanup({ version, dryRun: false }, existing)).resolves.toBeUndefined()
})
test("nightly workflow pins tags, avoids latest and serializes channel writes", async () => {
  const workflow = await Bun.file(path.join(control, ".github/workflows/release-cos.yml")).text()
  expect(workflow).toContain('test "$TAG_SHA" = "$GITHUB_SHA"')
  expect(workflow).toContain("--prerelease --latest=false --verify-tag")
  expect(workflow).toContain("group: cz-cli-cos-publication")
  expect(workflow).toContain('&& [ "${{ steps.release.outputs.is_stable }}" = "true" ]')
})
