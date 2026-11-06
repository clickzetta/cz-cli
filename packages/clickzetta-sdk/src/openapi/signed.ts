import { createHmac, randomInt } from "node:crypto"

/**
 * AccessKey-signed call to the ClickZetta OpenAPI (`/openapi/v2/**`), matching the official Java
 * SDK (`clickzetta-openapi-java-sdk` ApiClient) and the gateway check (`ZettaSignService.sign`).
 *
 * The gateway rebuilds the signed string from Format, Timestamp, SignatureMethod, SignatureVersion
 * and SignatureNonce in the query, signs `METHOD&%2F&percentEncode(query)` with HMAC-SHA1 keyed by
 * `secret + "&"`, and compares it with the `Signature` query param. The `accessKey` header selects
 * the secret, and the key's owner becomes the caller (`X-Gw-Context`).
 */
export interface OpenApiCredentials {
  accessKey: string
  secretKey: string
}

export interface OpenApiResponse<T = unknown> {
  status: number
  body: T
}

export function percentEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A")
}

/** GMT time as `yyyy-MM-dd'T'HH.mm.ss`, the format the Java SDK sends. */
function signTimestamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${now.getUTCFullYear()}-${p(now.getUTCMonth() + 1)}-${p(now.getUTCDate())}T${p(now.getUTCHours())}.${p(now.getUTCMinutes())}.${p(now.getUTCSeconds())}`
}

export function signOpenApiQuery(
  method: string,
  params: Record<string, string>,
  secretKey: string,
): string {
  const query = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&")
  const toSign = `${method}&${percentEncode("/")}&${percentEncode(query)}`
  const signature = createHmac("sha1", `${secretKey}&`).update(toSign, "utf8").digest("base64")
  return method === "POST" ? signature : encodeURIComponent(signature)
}

export async function openApiRequest<T = unknown>(
  baseUrl: string,
  path: string,
  body: unknown,
  credentials: OpenApiCredentials,
  opts: { method?: string; now?: Date; nonce?: string } = {},
): Promise<OpenApiResponse<T>> {
  const method = opts.method ?? "POST"
  const params: Record<string, string> = {
    Format: "JSON",
    Timestamp: percentEncode(signTimestamp(opts.now ?? new Date())),
    SignatureMethod: "HMAC-SHA1",
    SignatureVersion: "1.0",
    SignatureNonce: opts.nonce ?? String(randomInt(1_000_000_000, 10_000_000_000)),
  }
  const signature = signOpenApiQuery(method, params, credentials.secretKey)
  const query = [...Object.entries(params), ["Signature", signature]]
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&")
  const resp = await fetch(`${baseUrl.replace(/\/$/, "")}${path}?${query}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      method,
      accessKey: credentials.accessKey,
      t: String(Date.now()),
      signMethod: "HMAC-SHA256",
      signVersion: "v1.0",
      nonce: params.SignatureNonce,
      sign: signature,
    },
    body: method === "GET" || body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await resp.text()
  let parsed: unknown = text
  try { parsed = JSON.parse(text) } catch { /* keep raw text */ }
  return { status: resp.status, body: parsed as T }
}
