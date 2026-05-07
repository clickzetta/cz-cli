/**
 * Bearer token authentication middleware for Hono
 *
 * Python → TS mapping (core/mcp_middleware.py):
 *   mcp_middleware.py:1-36  ClickzettaTokenVerifier / verify_token → bearerAuthMiddleware
 *
 * Divergence: Python uses MCP SDK's TokenVerifier + HornhubClient for JWT validation.
 * TS uses a simpler static-token comparison (the token is passed in at startup via --token).
 * Block 2 can swap in a real JWT verifier without changing the middleware signature.
 */

import type { Context, MiddlewareHandler, Next } from "hono"

/**
 * bearerAuthMiddleware — mcp_middleware.py:14-35
 *
 * Checks the Authorization header for a valid Bearer token.
 * Returns 401 JSON if the token is missing or does not match validToken.
 * If validToken is empty/undefined, auth is disabled (dev mode).
 */
export function bearerAuthMiddleware(validToken: string | undefined): MiddlewareHandler {
  return async (c: Context, next: Next): Promise<Response | void> => {
    // If no token configured, skip auth (dev / open mode)
    // mcp_middleware.py:20 — if not token: return await call_next(request)
    if (!validToken) {
      return next()
    }

    // mcp_middleware.py:22 — authorization = request.headers.get("Authorization")
    const authorization = c.req.header("Authorization")

    // mcp_middleware.py:23-26 — check Bearer prefix and token value
    if (!authorization || !authorization.startsWith("Bearer ")) {
      return c.json(
        { error: "Unauthorized", message: "Missing or malformed Authorization header" },
        401,
      )
    }

    const token = authorization.slice("Bearer ".length).trim()

    // mcp_middleware.py:27-30 — if token != valid_token: return 401
    if (token !== validToken) {
      return c.json(
        { error: "Unauthorized", message: "Invalid Bearer token" },
        401,
      )
    }

    // mcp_middleware.py:32 — return await call_next(request)
    return next()
  }
}
