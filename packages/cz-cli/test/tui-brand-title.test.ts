import { describe, expect, test } from "bun:test"
import { czBrandTitle, installTerminalTitleBrand } from "../src/opencode-plugin/tui-title-brand"

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
  test("wraps setTerminalTitle so upstream writes are rebranded", () => {
    const { api, renderer, calls } = makeFakeApi()
    installTerminalTitleBrand(api as any)

    renderer.setTerminalTitle("OpenCode")
    renderer.setTerminalTitle("OC | task 1")
    renderer.setTerminalTitle("")

    expect(calls).toEqual(["CZ CLI", "CZ | task 1", ""])
  })

  test("is idempotent — a second install does not double-wrap", () => {
    const { api, renderer, calls } = makeFakeApi()
    installTerminalTitleBrand(api as any)
    installTerminalTitleBrand(api as any)

    renderer.setTerminalTitle("OpenCode")
    expect(calls).toEqual(["CZ CLI"])
  })

  test("onDispose restores the original setTerminalTitle", () => {
    const { api, renderer, calls, disposers } = makeFakeApi()
    installTerminalTitleBrand(api as any)
    for (const fn of disposers) fn()

    renderer.setTerminalTitle("OpenCode")
    expect(calls).toEqual(["OpenCode"])
  })
})
