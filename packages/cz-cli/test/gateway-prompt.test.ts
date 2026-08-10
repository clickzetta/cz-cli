/**
 * Unit tests for the TUI's gateway billing/quota prompt planner.
 * Run: bun test test/gateway-prompt.test.ts
 *
 * Two things are worth locking here. First, that a `session.error` payload is
 * classified from its `responseBody` alone — the rewrite happens inside the
 * file:// provider asset, a different module graph, and opencode's APIError schema
 * carries no custom field, so re-running the classifier on the surviving body is
 * the whole mechanism. Second, WHICH kinds get a browser jump: offering the
 * API-key console for a complimentary key would send the user somewhere they can
 * do nothing, since that key's ceiling is not theirs to raise.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { onStudio, requireTestHome, studioOk, stubStudioContext } from "./support/cz-fixtures.js"
import { accountTopUpUrl } from "../src/commands/account-login.js"
import {
  classifyGatewayError,
  gatewayErrorFields,
  planGatewayNotice,
  type GatewayNoticePlan,
} from "../src/opencode-plugin/gateway-prompt.ts"

const originalProfile = process.env.CZ_PROFILE

/** A `session.error` payload as opencode publishes it (NamedError.toObject). */
function sessionError(input: { message: string; statusCode?: number; responseBody?: string }) {
  return { name: "APIError", data: { ...input, isRetryable: false } }
}

/** The browser-jump target, or undefined when the plan does something else. */
function planUrl(plan: GatewayNoticePlan | undefined) {
  return plan?.action.kind === "open-url" ? plan.action.url : undefined
}

const overdueBody = JSON.stringify({
  error: {
    code: "GATEWAY_TENANT_OVERDUE",
    message: "[G2] Tenant overdue. path=/v1/chat/completions, requestId=req-abc",
    source: "gateway",
    retry_history: null,
  },
})

const quotaBody = (alias: string) =>
  `Virtual key total quota exceeded: limit is 10000000 tokens for virtual key '${alias}', current usage: 10082801 tokens`

function writeProfiles(extra: string[] = []) {
  writeFileSync(
    join(requireTestHome(), ".clickzetta", "profiles.toml"),
    [
      'default_profile = "test"',
      "[profiles.test]",
      'pat = "pat"',
      'service = "uat-api.clickzetta.com"',
      'instance = "inst"',
      ...extra,
    ].join("\n"),
  )
}

beforeEach(() => {
  delete process.env.CZ_PROFILE
  writeProfiles()
})

afterEach(() => {
  if (originalProfile === undefined) delete process.env.CZ_PROFILE
  else process.env.CZ_PROFILE = originalProfile
})

describe("gatewayErrorFields", () => {
  test("reads the nested event shape", () => {
    const fields = gatewayErrorFields(sessionError({ message: "boom", statusCode: 429, responseBody: "body" }))
    expect(fields).toEqual({ message: "boom", statusCode: 429, responseBody: "body" })
  })

  test("also accepts a bare APIError-like object", () => {
    expect(gatewayErrorFields({ message: "boom", statusCode: 403 })).toEqual({
      message: "boom",
      statusCode: 403,
      responseBody: undefined,
    })
  })

  test("a payload with no message yields nothing to classify", () => {
    expect(gatewayErrorFields({ data: { statusCode: 500 } })).toBeUndefined()
    expect(gatewayErrorFields(undefined)).toBeUndefined()
  })
})

describe("classifyGatewayError", () => {
  test("recovers the code from responseBody alone", () => {
    // The message here says nothing billing-related; only the nested code does.
    const r = classifyGatewayError(sessionError({ message: "Request rejected", statusCode: 403, responseBody: overdueBody }))
    expect(r?.code).toBe("GATEWAY_TENANT_OVERDUE")
    expect(r?.requestId).toBe("req-abc")
  })

  test("tenant over-quota is NOT promptable", () => {
    // A cycle cap is not lifted by paying, and the per-key console cannot lift it
    // either — raising one key's ceiling leaves the tenant-level cap in force. So
    // no page applies and the advice stays text-only.
    const body = JSON.stringify({ error: { code: "GATEWAY_TENANT_OVER_QUOTA", message: "[G2] Tenant over quota" } })
    expect(classifyGatewayError(sessionError({ message: "blocked", statusCode: 403, responseBody: body }))).toBeUndefined()
  })

  test("an undocumented 429 quota body is NOT promptable", () => {
    // These used to be classified by matching the body prose and reading the key
    // alias out of it. With no documented code behind them there is nothing to
    // branch on, so no dialog is offered for either kind of key.
    for (const alias of ["paid_key_001", "cz-code_auto_alice"]) {
      const body = quotaBody(alias)
      expect(classifyGatewayError(sessionError({ message: body, statusCode: 429, responseBody: body }))).toBeUndefined()
    }
  })

  test("codes with no tailored advice are NOT promptable", () => {
    for (const code of ["GATEWAY_VIRTUAL_KEY_DISABLED", "UPSTREAM_ALL_FAILED"]) {
      const body = JSON.stringify({ error: { code, message: "[G2] blocked" } })
      expect(classifyGatewayError(sessionError({ message: "blocked", statusCode: 401, responseBody: body }))).toBeUndefined()
    }
  })

  test("an ordinary failure is NOT promptable", () => {
    expect(classifyGatewayError(sessionError({ message: "upstream hiccup", statusCode: 503 }))).toBeUndefined()
  })
})

describe("planGatewayNotice", () => {
  /**
   * The planner asks the portal who we actually are. stubStudioContext's
   * getCurrentUser deliberately omits accountDisplayName (nothing else needs it),
   * so tests that want a resolvable console register a richer one first —
   * handlers match in registration order.
   */
  function stubRuntimeAccount(accountDisplayName: string) {
    onStudio("/clickzetta-portal/user/getCurrentUser", () =>
      studioOk({ id: 13, name: "UAT_TEST", accountId: 10, accountDisplayName }),
    )
    stubStudioContext()
  }

  test("overdue plans a top-up jump naming the runtime account", async () => {
    stubRuntimeAccount("runtime_acct")
    const plan = await planGatewayNotice(
      sessionError({ message: "Request rejected", statusCode: 403, responseBody: overdueBody }),
    )
    expect(plan?.code).toBe("GATEWAY_TENANT_OVERDUE")
    expect(plan?.message).toContain("unpaid charges")
    // The account is named so a multi-key user can tell whether this is the
    // tenant that actually owes money before paying.
    expect(plan?.message).toContain("runtime_acct")
    // Lands on the top-up form, not the console home — see accountTopUpUrl.
    expect(planUrl(plan)).toBe(accountTopUpUrl("https://runtime_acct.uat-accounts.clickzetta.com"))
  })

  test("overdue with no derivable console yields no prompt", async () => {
    // Paying is only possible at an accounts site; without one there is nothing
    // to offer and the raw error should stand alone. No profile account_name, and
    // the default stub's getCurrentUser carries no accountDisplayName.
    stubStudioContext()
    const plan = await planGatewayNotice(
      sessionError({ message: "Request rejected", statusCode: 403, responseBody: overdueBody }),
    )
    expect(plan).toBeUndefined()
  })

  test("the account named in the copy is the account the URL points at", async () => {
    // The whole point of naming the account is letting a multi-key user check
    // they are about to pay the right tenant. If the copy says one thing and the
    // URL goes somewhere else, the check is worse than useless. This regressed
    // once: the copy used the portal lookup while the URL silently fell back to
    // the profile field, so an offline run showed an unnamed page for acme_corp.
    writeProfiles(['account_name = "acme_corp"'])
    // An unreachable portal answers with a non-ok status, not a thrown fetch;
    // getCurrentUser then rejects and the planner falls back to the profile.
    onStudio("/clickzetta-portal/user/getCurrentUser", () => ({ code: 500, message: "portal unreachable" }))
    stubStudioContext()
    const plan = await planGatewayNotice(
      sessionError({ message: "Request rejected", statusCode: 403, responseBody: overdueBody }),
    )
    expect(plan).toBeDefined()
    expect(/billing page for (\S+?)\?/.exec(plan!.message)?.[1]).toBe("acme_corp")
    expect(planUrl(plan)).toContain("//acme_corp.")
  })

  test("overdue falls back to the profile's account_name when the portal is unreachable", async () => {
    // A failed identity lookup must not cost the prompt entirely — the stored name
    // is stale-prone but is still the best guess available offline.
    writeProfiles(['account_name = "stored_acct"'])
    onStudio("/clickzetta-portal/user/getCurrentUser", () => ({ code: 500, message: "portal down" }))
    stubStudioContext()
    const plan = await planGatewayNotice(
      sessionError({ message: "Request rejected", statusCode: 403, responseBody: overdueBody }),
    )
    expect(plan?.code).toBe("GATEWAY_TENANT_OVERDUE")
    expect(planUrl(plan)).toBe(accountTopUpUrl("https://stored_acct.uat-accounts.clickzetta.com"))
  })

  test("an unclassifiable error never reaches the network", async () => {
    // No fetch handlers registered at all: the boundary throws on any request, so
    // this passing proves classification short-circuits before the portal call.
    const body = quotaBody("paid_key_001")
    expect(await planGatewayNotice(sessionError({ message: body, statusCode: 429, responseBody: body }))).toBeUndefined()
  })

  test("an aborted signal yields no prompt", async () => {
    stubRuntimeAccount("runtime_acct")
    const controller = new AbortController()
    controller.abort()
    const plan = await planGatewayNotice(
      sessionError({ message: "Request rejected", statusCode: 403, responseBody: overdueBody }),
      { signal: controller.signal },
    )
    expect(plan).toBeUndefined()
  })
})

/**
 * A spent complimentary key is the one case whose remedy is local: mint the user's
 * own key into the SAME llm.json entry, so `config.model` keeps resolving and the
 * active model survives. These lock the preconditions for offering that — and that
 * no portal call is made on the way, since nothing about it needs one.
 *
 * The entry comes from the caller's `activeProviderID` (the TUI's runtime
 * active-model context), NEVER from `config.model`. That distinction is the whole
 * point: opencode treats config.model as a first candidate and falls through to
 * other providers, so deriving the entry from it swapped the new key into the wrong
 * llm.json entry and left the erroring one exhausted. The last test here pins that.
 */
describe("planGatewayNotice — spent complimentary key", () => {
  const spentBody = (alias: string) =>
    JSON.stringify({
      error: {
        code: "GATEWAY_TOO_MANY_REQUESTS",
        message: `[G2] Too many requests. virtualApiKeyAlias=${alias}`,
      },
    })

  const spentError = (alias: string) => {
    const body = spentBody(alias)
    return sessionError({ message: body, statusCode: 429, responseBody: body })
  }

  function writeLlm(entries: Record<string, unknown>, model?: string) {
    writeFileSync(
      join(requireTestHome(), ".clickzetta", "llm.json"),
      JSON.stringify({ provider: entries, ...(model ? { model } : {}) }),
    )
  }

  const clickzettaEntry = {
    name: "cc",
    npm: "@clickzetta/ai-gateway",
    api: "",
    env: [],
    options: { apiKey: "spent", baseURL: "https://uat-aimesh.clickzetta.com/gateway/v1" },
  }

  test("offers to provision into the active provider's entry", async () => {
    writeLlm({ cc: clickzettaEntry }, "cc/deepseek/deepseek-v4-pro")
    const plan = await planGatewayNotice(spentError("cz-code_auto_alice"), { activeProviderID: "cc" })
    expect(plan?.code).toBe("GATEWAY_TOO_MANY_REQUESTS")
    expect(plan?.action).toEqual({ kind: "provision-key", entry: "cc" })
    // The billing consequence must be stated: this is the user's money from here.
    expect(plan?.message).toContain("billed to your account")
  })

  test("a key the user provisioned is NOT offered", async () => {
    // Its ceiling IS theirs to raise, and replacing it would discard the routing
    // and quota settings they chose.
    writeLlm({ cc: clickzettaEntry }, "cc/deepseek/deepseek-v4-pro")
    expect(await planGatewayNotice(spentError("paid_key_001"), { activeProviderID: "cc" })).toBeUndefined()
  })

  test("no plan when the active provider is unknown", async () => {
    // Nothing to swap a key into, and guessing could clobber an unrelated entry.
    writeLlm({ cc: clickzettaEntry }, "cc/deepseek/deepseek-v4-pro")
    expect(await planGatewayNotice(spentError("cz-code_auto_alice"))).toBeUndefined()
  })

  test("no plan when the active provider is not a clickzetta entry", async () => {
    writeLlm(
      { other: { name: "other", npm: "@ai-sdk/openai", options: { apiKey: "sk" } }, cc: clickzettaEntry },
      "other/gpt-4.1",
    )
    expect(await planGatewayNotice(spentError("cz-code_auto_alice"), { activeProviderID: "other" })).toBeUndefined()
  })

  test("targets the ACTIVE provider, not the one config.model names", async () => {
    // The regression this whole change exists for: opencode auto-selected `other`
    // while config.model still pointed at `cc`, so the new key landed on `cc` and
    // the exhausted `other` kept failing. config.model must not influence the target.
    writeLlm({ cc: clickzettaEntry, other: { ...clickzettaEntry, name: "other" } }, "cc/deepseek/deepseek-v4-pro")
    const plan = await planGatewayNotice(spentError("cz-code_auto_alice"), { activeProviderID: "other" })
    expect(plan?.action).toEqual({ kind: "provision-key", entry: "other" })
  })
})
