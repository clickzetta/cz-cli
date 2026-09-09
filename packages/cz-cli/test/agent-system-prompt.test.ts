import { describe, expect, test } from "bun:test"
import { CLICKZETTA_AGENT_SYSTEM_PROMPT } from "../src/agent-system-prompt.js"

describe("ClickZetta agent prompt", () => {
  test("distinguishes table load CLI flags from COPY SQL syntax", () => {
    expect(CLICKZETTA_AGENT_SYSTEM_PROMPT).toContain("--using/--header are CLI flags only, not SQL syntax")
    expect(CLICKZETTA_AGENT_SYSTEM_PROMPT).toContain("<full Lakehouse COPY INTO/OVERWRITE statement>")
    expect(CLICKZETTA_AGENT_SYSTEM_PROMPT).toContain("Do not put table-load flags such as --using or --header inside the SQL statement")
  })

  test("uses a file for long or quote-heavy Analytics Agent domain prompts", () => {
    expect(CLICKZETTA_AGENT_SYSTEM_PROMPT).toContain("--prompt-file <file>")
    expect(CLICKZETTA_AGENT_SYSTEM_PROMPT).toContain("long, multiline, or quote-heavy prompts")
    expect(CLICKZETTA_AGENT_SYSTEM_PROMPT).toContain("mutually exclusive")
  })
})
