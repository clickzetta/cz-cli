import { expect, mock, test } from "bun:test"
import { performUpgrade } from "../../src/update/bootstrap"

test("performUpgrade allows an explicit older target version", async () => {
  const fetchImpl = mock(async () =>
    new Response(
      [
        "#!/bin/sh",
        'if [ "$VERSION" != "0.3.88" ]; then exit 11; fi',
        'echo "Downgrading to $VERSION"',
        "exit 0",
      ].join("\n"),
    ),
  ) as unknown as typeof fetch

  await expect(performUpgrade("curl", "0.3.88", fetchImpl, "stable")).resolves.toBeUndefined()
})
