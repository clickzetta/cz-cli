import { request, type ClientOptions } from "../client.js"

export async function agentHealth(baseUrl: string): Promise<boolean> {
  try {
    const opts: ClientOptions = { baseUrl, timeout: 5000 }
    await request(opts, "/ai/health", undefined, "GET")
    return true
  } catch {
    return false
  }
}

export async function createConversation(
  baseUrl: string,
  token: string,
  identity: Record<string, unknown>,
): Promise<string> {
  const opts: ClientOptions = {
    baseUrl,
    customHeaders: { "x-clickzetta-token": token },
  }
  const resp = await request<{ conversationId: string }>(
    opts,
    "/ai/api/conversations",
    identity,
  )
  return resp.data.conversationId
}

export async function chat(
  baseUrl: string,
  token: string,
  conversationId: string,
  question: string,
): Promise<string> {
  const opts: ClientOptions = {
    baseUrl,
    customHeaders: { "x-clickzetta-token": token },
    timeout: 300000,
  }
  const resp = await request<{ answer: string }>(
    opts,
    "/ai/api/chat",
    { conversationId, question },
  )
  return resp.data.answer
}
