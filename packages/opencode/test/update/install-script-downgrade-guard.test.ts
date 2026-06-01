import { expect, mock, test } from "bun:test"
import { performUpgrade } from "../../src/update/bootstrap"

test("performUpgrade stops when the install script sees a newer local version", async () => {
  const fetchImpl = mock(async () =>
    new Response(
      [
        "#!/bin/sh",
        'if [ "$VERSION" != "0.3.88" ]; then exit 11; fi',
        'echo "A newer version is already installed: 0.3.92" >&2',
        "exit 0",
      ].join("\n"),
    ),
  ) as unknown as typeof fetch

  await expect(performUpgrade("curl", "0.3.88", fetchImpl, "stable")).resolves.toBeUndefined()
})
