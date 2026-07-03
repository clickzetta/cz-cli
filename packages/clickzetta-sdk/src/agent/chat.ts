import { request, type ClientOptions } from "../client.js"

export interface AgentIdentity {
  user_id: string
  tenant_id: string
  instance_id: string
  token: string
  instance_name?: string
  workspace?: string
  workspace_id?: string
  schema_name?: string
}

export async function agentHealth(baseUrl: string, token?: string): Promise<Record<string, unknown> | false> {
  try {
    const opts: ClientOptions = {
      baseUrl,
      timeout: 10000,
      ...(token ? { customHeaders: { "x-clickzetta-token": token } } : {}),
    }
    const resp = await request<Record<string, unknown>>(opts, "/ai/health", undefined, "GET")
    return resp.data ?? (resp as unknown as Record<string, unknown>)
  } catch {
    return false
  }
}

export async function createConversation(
  baseUrl: string,
  token: string,
  identity: AgentIdentity,
  title?: string,
): Promise<string> {
  const opts: ClientOptions = {
    baseUrl,
    customHeaders: { "x-clickzetta-token": token },
    timeout: 300000,
  }
  const payload: Record<string, unknown> = { identity }
  if (title) payload.title = title
  const resp = await request<{ conversation_id?: string; conversationId?: string }>(
    opts,
    "/ai/api/conversations",
    payload,
  )
  return resp.data.conversation_id ?? resp.data.conversationId ?? ""
}

export async function chat(
  baseUrl: string,
  token: string,
  conversationId: string,
  userMessage: string,
  identity: AgentIdentity,
): Promise<string> {
  const opts: ClientOptions = {
    baseUrl,
    customHeaders: { "x-clickzetta-token": token },
    timeout: 300000,
  }
  const resp = await request<{ answer: string }>(
    opts,
    "/ai/api/chat",
    { conversation_id: conversationId, user_message: userMessage, identity },
  )
  return resp.data.answer
}
