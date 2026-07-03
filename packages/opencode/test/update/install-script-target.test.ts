import { expect, mock, test } from "bun:test"
import { performUpgrade } from "../../src/update/bootstrap"

test("performUpgrade passes the resolved target version to the install script", async () => {
  const fetchImpl = mock(async () =>
    new Response(
        [
          "#!/bin/sh",
          'if [ "$1" != "--version" ]; then exit 13; fi',
          'if [ "$2" != "0.3.92" ]; then exit 14; fi',
          'if [ "$VERSION" != "0.3.92" ]; then exit 12; fi',
        ].join("\n"),
    ),
  ) as unknown as typeof fetch

  await expect(performUpgrade("curl", "0.3.92", fetchImpl, "stable")).resolves.toBeUndefined()
})
