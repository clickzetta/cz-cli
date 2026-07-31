import { expect, test } from "bun:test"
import { sessionEpilogue } from "../../src/util/presentation"

test("formats session continuation summary", () => {
  const epilogue = sessionEpilogue({ title: "A session", sessionID: "ses_123" })
  expect(epilogue).toContain("A session")
  //======================== cz-cli change ========================
  // Continue hint is `cz-agent -s`, not `opencode -s` — see the banner in
  // src/util/presentation.ts. `opencode -s` would be a dead end for cz users.
  expect(epilogue).toContain("cz-agent -s ses_123")
  expect(epilogue).not.toContain("opencode -s")
  //====================== end cz-cli change ======================
})
