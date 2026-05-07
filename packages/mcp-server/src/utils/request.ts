/**
 * request utils — port of cz-mcp-server/cz_mcp/utils/request_utils.py
 *
 * Python → TS mapping:
 *   request_utils.py:9-16   Request.get()   → Request.get()
 *   request_utils.py:18-22  Request.post()  → Request.post()
 *   request_utils.py:24-40  Request.get_data() → Request.getData()
 *
 * Divergences from Python:
 *   - Python uses `requests` library + urllib3 InsecureRequestWarning suppression.
 *     TS uses the built-in fetch API (Node.js 18+). SSL verification is not
 *     configurable via fetch; rejectUnauthorized is handled at the agent level.
 *   - Python uses jsonpath_ng for JSONPath evaluation.
 *     TS implements a simple dot-notation path resolver (no new npm deps).
 *   - Method names are camelCase per TS convention (get_data → getData).
 */

// request_utils.py:9
export class Request {
  // request_utils.py:11-16 — GET request wrapper
  async get(url: string, params?: Record<string, string>, init?: RequestInit): Promise<Response> {
    const fullUrl = params ? `${url}?${new URLSearchParams(params).toString()}` : url
    return fetch(fullUrl, { method: "GET", ...init })
  }

  // request_utils.py:18-22 — POST request wrapper
  async post(url: string, params?: Record<string, string>, init?: RequestInit): Promise<Response> {
    const fullUrl = params ? `${url}?${new URLSearchParams(params).toString()}` : url
    return fetch(fullUrl, { method: "POST", ...init })
  }

  // request_utils.py:24-40 — Extract data using JSONPath-like expressions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getData(response: string, key: string): any {
    // Parse JSON response
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dictData: Record<string, any> = JSON.parse(response)

    // Strip '$.' prefix to get plain dot-notation path (request_utils.py:30-31)
    const path = key.startsWith("$.") ? key.slice(2) : key

    // Resolve dot-notation path (replaces jsonpath_ng.parse + find)
    const parts = path.split(".")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let current: any = dictData
    for (const part of parts) {
      if (current === null || current === undefined) return null
      current = current[part]
    }

    return current ?? null
  }
}
