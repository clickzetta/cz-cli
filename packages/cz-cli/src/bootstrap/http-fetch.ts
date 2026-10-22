/**
 * CVE-2026-111497: keep untrusted HTTP bodies out of Bun's native Brotli
 * decoder until a patched stable runtime is available. Negotiation alone is
 * insufficient: a server can send br even when it was not requested.
 */
export function createSafeFetch(nativeFetch: typeof fetch): typeof fetch {
  return Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    // Bun's extension is not present in the shared DOM RequestInit type.
    if (init && "decompress" in init && init.decompress === false) return nativeFetch(input, init)
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.set("accept-encoding", "gzip, deflate")
    const response = await nativeFetch(input, { ...init, headers, decompress: false })
    // Bun can expose a non-null empty stream for bodyless responses. Their
    // encoding headers describe representation metadata, not a body to decode.
    if (
      (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase() === "HEAD" ||
      [204, 205, 304].includes(response.status)
    ) {
      return response
    }
    const encodings = (response.headers.get("content-encoding") ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value && value !== "identity")
    if (encodings.some((value) => value !== "gzip" && value !== "deflate")) {
      await response.body?.cancel()
      throw new TypeError(
        "Unsupported HTTP content encoding: Brotli and other unnegotiated encodings are disabled for CVE-2026-111497",
      )
    }
    if (!response.body || encodings.length === 0) return response

    const decoded = encodings
      .toReversed()
      .reduce(
        (body, encoding) => body.pipeThrough(new DecompressionStream(encoding === "gzip" ? "gzip" : "deflate")),
        response.body,
      )
    const decodedHeaders = new Headers(response.headers)
    decodedHeaders.delete("content-encoding")
    decodedHeaders.delete("content-length")
    return withResponseMetadata(
      new Response(decoded, { status: response.status, statusText: response.statusText, headers: decodedHeaders }),
      response,
    )
  }, nativeFetch)
}

function withResponseMetadata(response: Response, source: Response) {
  const clone = response.clone.bind(response)
  // Response's constructor does not retain fetch metadata; SDKs inspect url,
  // redirected and type, including on clones used for error handling.
  Object.defineProperties(response, {
    url: { value: source.url },
    redirected: { value: source.redirected },
    type: { value: source.type },
    clone: { value: () => withResponseMetadata(clone(), source) },
  })
  return response
}
