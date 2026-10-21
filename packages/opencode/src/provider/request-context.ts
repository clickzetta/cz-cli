import { AsyncLocalStorage } from "node:async_hooks"

export type CapturedRequest = { url: string; method: string; body: string }
export type Observer = (request: CapturedRequest) => Promise<void>

const storage = new AsyncLocalStorage<Observer>()

/** Scope wire capture to a provider invocation, including concurrent sessions. */
export function observe<T>(observer: Observer, run: () => T): T {
  return storage.run(observer, run)
}

export async function record(input: RequestInfo | URL, init?: RequestInit, observer = storage.getStore()) {
  if (!observer) return
  const body = init?.body
  const text =
    typeof body === "string"
      ? body
      : body instanceof ArrayBuffer
        ? new TextDecoder().decode(body)
        : ArrayBuffer.isView(body)
          ? new TextDecoder().decode(body)
          : body instanceof Blob
            ? await body.text()
            : body instanceof URLSearchParams
              ? body.toString()
              : body == null && input instanceof Request
                ? await input.clone().text()
                : undefined
  if (text === undefined) return
  await observer({
    url: input instanceof Request ? input.url : String(input),
    method: init?.method ?? (input instanceof Request ? input.method : "POST"),
    body: text,
  })
}

export * as ProviderRequest from "./request-context"
