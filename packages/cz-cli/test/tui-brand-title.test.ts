import { describe, expect, test } from "bun:test"
import {
  czAbbreviateHome,
  czBrandTitle,
  czFooterPath,
  installTerminalTitleBrand,
  CZ_BRAND_LEAD,
  CZ_BRAND_TAIL,
} from "../src/opencode-plugin/tui-title-brand"

describe("czBrandTitle", () => {
  test("rebrands the bare home/no-title title", () => {
    expect(czBrandTitle("OpenCode")).toBe("CZ CLI")
  })

  test("rebrands the prefixed session/plugin title, preserving the tail", () => {
    expect(czBrandTitle("OC | fix login bug")).toBe("CZ | fix login bug")
    expect(czBrandTitle("OC | my-plugin")).toBe("CZ | my-plugin")
  })

  test("passes empty string through (title disabled / teardown)", () => {
    expect(czBrandTitle("")).toBe("")
  })

  test("leaves unrelated titles untouched", () => {
    expect(czBrandTitle("Something Else")).toBe("Something Else")
    expect(czBrandTitle("OCwithoutspace")).toBe("OCwithoutspace")
  })
})

// The sidebar footer's brand line. Upstream's builtin renders "• OpenCode <ver>";
// the cz brand plugin claims the slot and renders these two tokens instead.
describe("sidebar footer brand", () => {
  test("spells CZ CLI, with no opencode token left", () => {
    expect(CZ_BRAND_LEAD + " " + CZ_BRAND_TAIL).toBe("CZ CLI")
    expect((CZ_BRAND_LEAD + CZ_BRAND_TAIL).toLowerCase()).not.toContain("code")
  })
})

describe("czAbbreviateHome", () => {
  test("collapses the home prefix", () => {
    expect(czAbbreviateHome("/Users/x/playground/hello", "/Users/x")).toBe("~/playground/hello")
  })

  test("returns home itself as a bare ~", () => {
    expect(czAbbreviateHome("/Users/x", "/Users/x")).toBe("~")
  })

  test("leaves paths outside home untouched", () => {
    expect(czAbbreviateHome("/tmp/work", "/Users/x")).toBe("/tmp/work")
  })

  test("passes through when home is unknown", () => {
    expect(czAbbreviateHome("/tmp/work", "")).toBe("/tmp/work")
  })
})

describe("czFooterPath", () => {
  test("splits off the last segment so it can be emphasized", () => {
    expect(czFooterPath({ directory: "/Users/x/playground/hello", home: "/Users/x" })).toEqual({
      parent: "~/playground",
      name: "hello",
    })
  })

  test("appends the branch to the emphasized segment", () => {
    expect(czFooterPath({ directory: "/Users/x/repo", home: "/Users/x", branch: "main" })).toEqual({
      parent: "~",
      name: "repo:main",
    })
  })

  test("handles a directory that abbreviates to bare ~", () => {
    expect(czFooterPath({ directory: "/Users/x", home: "/Users/x" })).toEqual({ parent: "", name: "~" })
  })
})

function makeFakeApi() {
  const calls: string[] = []
  const disposers: Array<() => void> = []
  const renderer = {
    setTerminalTitle(title: string) {
      calls.push(title)
    },
  }
  const api = {
    renderer,
    lifecycle: {
      onDispose(fn: () => void) {
        disposers.push(fn)
        return () => {}
      },
    },
  }
  return { api, renderer, calls, disposers }
}

describe("installTerminalTitleBrand", () => {
  // Install emits ONE catch-up write (the home title upstream already wrote before
  // plugins loaded — see the cz_change note in tui-title-brand.ts), so every
  // expectation below starts with "CZ CLI".
  test("emits a catch-up write so the home title is branded immediately", () => {
    const { api, calls } = makeFakeApi()
    installTerminalTitleBrand(api as any)
    expect(calls).toEqual(["CZ CLI"])
  })

  test("wraps setTerminalTitle so upstream writes are rebranded", () => {
    const { api, renderer, calls } = makeFakeApi()
    installTerminalTitleBrand(api as any)

    renderer.setTerminalTitle("OpenCode")
    renderer.setTerminalTitle("OC | task 1")
    renderer.setTerminalTitle("")

    expect(calls).toEqual(["CZ CLI", "CZ CLI", "CZ | task 1", ""])
  })

  test("is idempotent — a second install does not double-wrap", () => {
    const { api, renderer, calls } = makeFakeApi()
    installTerminalTitleBrand(api as any)
    installTerminalTitleBrand(api as any)

    renderer.setTerminalTitle("OpenCode")
    expect(calls).toEqual(["CZ CLI", "CZ CLI"])
  })

  test("onDispose restores the original setTerminalTitle", () => {
    const { api, renderer, calls, disposers } = makeFakeApi()
    installTerminalTitleBrand(api as any)
    for (const fn of disposers) fn()

    renderer.setTerminalTitle("OpenCode")
    expect(calls).toEqual(["CZ CLI", "OpenCode"])
  })

  test("skips the catch-up write when the user disabled terminal titles", () => {
    const { api, calls } = makeFakeApi()
    installTerminalTitleBrand({
      ...(api as any),
      kv: { get: (_k: string, _f: boolean) => false },
    })
    expect(calls).toEqual([])
  })

  test("skips the catch-up write when OPENCODE_DISABLE_TERMINAL_TITLE is set", () => {
    const { api, calls } = makeFakeApi()
    const prev = process.env.OPENCODE_DISABLE_TERMINAL_TITLE
    process.env.OPENCODE_DISABLE_TERMINAL_TITLE = "1"
    try {
      installTerminalTitleBrand(api as any)
      expect(calls).toEqual([])
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_DISABLE_TERMINAL_TITLE
      else process.env.OPENCODE_DISABLE_TERMINAL_TITLE = prev
    }
  })

  test("a throwing kv does not break activation", () => {
    const { api, renderer, calls } = makeFakeApi()
    installTerminalTitleBrand({
      ...(api as any),
      kv: {
        get() {
          throw new Error("kv not ready")
        },
      },
    })
    // Still wrapped despite the kv failure.
    renderer.setTerminalTitle("OC | x")
    expect(calls).toContain("CZ | x")
  })
})
