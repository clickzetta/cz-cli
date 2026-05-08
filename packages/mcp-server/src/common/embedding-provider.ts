/**
 * embedding-provider.ts — port of cz_mcp/common/embedding_provider.py
 */

import { createHash } from "node:crypto"
import { logger } from "../logger.js"

export interface EmbeddingProviderBackend {
  getEmbedding(text: string | string[]): Promise<number[] | number[][]>
}

export interface EmbeddingConfig {
  provider?: string
  dashscope?: { api_key?: string; model?: string; max_text_length?: number; api_base?: string }
  openai?: { api_key?: string; model?: string; api_base?: string; max_text_length?: number }
  cache?: { enabled?: boolean; max_size?: number }
}

export class EmbeddingProvider {
  private config: EmbeddingConfig
  private provider: string
  private _providerInstance: EmbeddingProviderBackend | null = null
  private _cache: Map<string, number[]> = new Map()
  private cacheEnabled: boolean
  private cacheMaxSize: number

  constructor(config: EmbeddingConfig) {
    this.config = config
    this.provider = config.provider ?? "dashscope"
    this.cacheEnabled = config.cache?.enabled ?? true
    this.cacheMaxSize = config.cache?.max_size ?? 10000
  }

  getProviderBackend(): EmbeddingProviderBackend {
    if (!this._providerInstance) {
      if (this.provider === "dashscope") {
        this._providerInstance = new DashScopeEmbeddingProvider(this.config.dashscope ?? {})
      } else if (this.provider === "openai") {
        this._providerInstance = new OpenAIEmbeddingProvider(this.config.openai ?? {})
      } else {
        throw new Error(`Unsupported provider: ${this.provider}. Supported providers: dashscope, openai`)
      }
    }
    return this._providerInstance
  }

  async getEmbedding(text: string | string[]): Promise<number[] | number[][]> {
    if (typeof text === "string") {
      if (this.cacheEnabled) {
        const cacheKey = this._getCacheKey(text)
        const cached = this._cache.get(cacheKey)
        if (cached) {
          logger.debug(`Cache hit: ${text.slice(0, 50)}...`)
          return [...cached]
        }
      }
      const embedding = (await this.getProviderBackend().getEmbedding(text)) as number[]
      if (this.cacheEnabled && this._cache.size < this.cacheMaxSize) {
        this._cache.set(this._getCacheKey(text), [...embedding])
      }
      return embedding
    }
    return this._getBatchEmbeddingsWithCache(text)
  }

  private _getCacheKey(text: string): string {
    return `${this.provider}:${createHash("md5").update(text).digest("hex")}`
  }

  private async _getBatchEmbeddingsWithCache(texts: string[]): Promise<number[][]> {
    const results: Array<[number, number[]]> = []
    const uncachedTexts: string[] = []
    const uncachedIndices: number[] = []

    for (let i = 0; i < texts.length; i++) {
      if (this.cacheEnabled) {
        const cacheKey = this._getCacheKey(texts[i])
        const cached = this._cache.get(cacheKey)
        if (cached) {
          results.push([i, [...cached]])
          continue
        }
      }
      uncachedTexts.push(texts[i])
      uncachedIndices.push(i)
    }

    if (uncachedTexts.length > 0) {
      const newEmbeddings = (await this.getProviderBackend().getEmbedding(uncachedTexts)) as number[][]
      for (let j = 0; j < uncachedIndices.length; j++) {
        const emb = newEmbeddings[j]
        if (this.cacheEnabled && this._cache.size < this.cacheMaxSize) {
          this._cache.set(this._getCacheKey(uncachedTexts[j]), [...emb])
        }
        results.push([uncachedIndices[j], emb])
      }
    }

    results.sort((a, b) => a[0] - b[0])
    return results.map(([, emb]) => emb)
  }
}

export class DashScopeEmbeddingProvider implements EmbeddingProviderBackend {
  private apiKey: string
  private model: string
  private maxTextLength: number
  private apiBase: string

  constructor(config: { api_key?: string; model?: string; max_text_length?: number; api_base?: string }) {
    this.apiKey = config.api_key ?? process.env.DASHSCOPE_API_KEY ?? ""
    this.model = config.model ?? "text-embedding-v4"
    this.maxTextLength = config.max_text_length ?? 2048
    this.apiBase = config.api_base ?? "https://dashscope.aliyuncs.com/compatible-mode/v1"
    if (!this.apiKey) {
      throw new Error("DashScope API key not configured. Set DASHSCOPE_API_KEY or provide api_key in config.")
    }
  }

  async getEmbedding(text: string | string[]): Promise<number[] | number[][]> {
    const isBatch = Array.isArray(text)
    const texts = isBatch ? text : [text]

    const processed = texts.map((t) => {
      if (!t || t.trim().length === 0) return "empty"
      if (t.length > this.maxTextLength) {
        logger.warn(`Text too long (${t.length} chars), truncating to ${this.maxTextLength}`)
        return t.slice(0, this.maxTextLength)
      }
      return t
    })

    const resp = await fetch(`${this.apiBase}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, input: processed }),
    })

    if (!resp.ok) {
      throw new Error(`DashScope API call failed: ${resp.status} ${await resp.text()}`)
    }

    const data = (await resp.json()) as { data: Array<{ embedding: number[] }> }
    const embeddings = data.data.map((item) => item.embedding)
    return isBatch ? embeddings : embeddings[0]
  }
}

export class OpenAIEmbeddingProvider implements EmbeddingProviderBackend {
  private apiKey: string
  private model: string
  private apiBase: string
  private maxTextLength: number

  constructor(config: { api_key?: string; model?: string; api_base?: string; max_text_length?: number }) {
    this.apiKey = config.api_key ?? process.env.OPENAI_API_KEY ?? ""
    this.model = config.model ?? "text-embedding-ada-002"
    this.apiBase = config.api_base ?? "https://api.openai.com/v1"
    this.maxTextLength = config.max_text_length ?? 8191
    if (!this.apiKey) {
      throw new Error("OpenAI API key not configured. Set OPENAI_API_KEY or provide api_key in config.")
    }
  }

  async getEmbedding(text: string | string[]): Promise<number[] | number[][]> {
    const isBatch = Array.isArray(text)
    const texts = isBatch ? text : [text]

    const processed = texts.map((t) => {
      if (!t || t.trim().length === 0) return "empty"
      if (t.length > this.maxTextLength) {
        logger.warn(`Text too long, truncating to ${this.maxTextLength} chars`)
        return t.slice(0, this.maxTextLength)
      }
      return t
    })

    const resp = await fetch(`${this.apiBase}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, input: processed }),
    })

    if (!resp.ok) {
      throw new Error(`OpenAI API call failed: ${resp.status} ${await resp.text()}`)
    }

    const data = (await resp.json()) as { data: Array<{ embedding: number[] }> }
    const embeddings = data.data.map((item) => item.embedding)
    return isBatch ? embeddings : embeddings[0]
  }
}

// Global embedding provider instance
let _embeddingProvider: EmbeddingProvider | null = null

export function initEmbeddingProvider(config: EmbeddingConfig): void {
  _embeddingProvider = new EmbeddingProvider(config)
  logger.info(`Initialized embedding provider: ${config.provider ?? "dashscope"}`)
}

export function getEmbeddingProvider(): EmbeddingProvider {
  if (!_embeddingProvider) {
    if (process.env.DASHSCOPE_API_KEY) {
      logger.info("Detected DashScope API key, using DashScope as default embedding provider")
      _embeddingProvider = new EmbeddingProvider({
        provider: "dashscope",
        dashscope: { api_key: process.env.DASHSCOPE_API_KEY, model: "text-embedding-v4" },
      })
    } else if (process.env.OPENAI_API_KEY) {
      logger.info("Detected OpenAI API key, using OpenAI as default embedding provider")
      _embeddingProvider = new EmbeddingProvider({
        provider: "openai",
        openai: { api_key: process.env.OPENAI_API_KEY, model: "text-embedding-ada-002" },
      })
    } else {
      throw new Error(
        "No embedding provider configured. Set DASHSCOPE_API_KEY or OPENAI_API_KEY environment variable.",
      )
    }
  }
  return _embeddingProvider
}

export interface UnstructuredEmbedderConfig {
  embedding_provider: string
  embedding_api_key: string
  embedding_model_name: string
  embedding_api_base: string
}

export function getUnstructuredEmbedderConfig(systemConfig: Record<string, unknown>): UnstructuredEmbedderConfig {
  const embeddingConfig = (systemConfig.embedding ?? {}) as EmbeddingConfig
  const provider = embeddingConfig.provider ?? "dashscope"

  if (provider === "dashscope") {
    const dc = embeddingConfig.dashscope ?? {}
    const apiKey = dc.api_key ?? process.env.DASHSCOPE_API_KEY ?? ""
    if (!apiKey) throw new Error("DashScope API key not configured")
    return {
      embedding_provider: "dashscope",
      embedding_api_key: apiKey,
      embedding_model_name: dc.model ?? "text-embedding-v4",
      embedding_api_base: dc.api_base ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
    }
  }

  if (provider === "openai") {
    const oc = embeddingConfig.openai ?? {}
    const apiKey = oc.api_key ?? process.env.OPENAI_API_KEY ?? ""
    if (!apiKey) throw new Error("OpenAI API key not configured")
    return {
      embedding_provider: "openai",
      embedding_api_key: apiKey,
      embedding_model_name: oc.model ?? "text-embedding-ada-002",
      embedding_api_base: oc.api_base ?? "https://api.openai.com/v1",
    }
  }

  throw new Error(`Unsupported embedding provider: ${provider}. Supported: dashscope, openai`)
}
