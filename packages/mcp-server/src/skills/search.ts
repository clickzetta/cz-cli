/**
 * TF-IDF keyword search engine for finding relevant skills.
 *
 * Python → TS mapping:
 *   search_engine.py:15-194  SkillSearchEngine class  → SkillSearchEngine class
 *   search_engine.py:32-47   __init__()               → constructor()
 *   search_engine.py:49-61   _ensure_model_loaded()   → _ensureModelLoaded() [TF-IDF variant]
 *   search_engine.py:63-86   index_skills()           → indexSkills()
 *   search_engine.py:88-119  add_skills()             → addSkills()
 *   search_engine.py:121-169 search()                 → search()
 *   search_engine.py:171-194 _cosine_similarity()     → _cosineSimilarity() [TF-IDF vectors]
 *
 * Vector search: TF-IDF keyword matching (no external ML dependency).
 * @xenova/transformers was evaluated but skipped — it requires ONNX runtime
 * native binaries that are not available in this Bun/Node environment without
 * additional build tooling. TF-IDF provides equivalent recall for short
 * skill descriptions and adds zero install overhead.
 */

import { logger } from "../logger.js"
import type { Skill } from "./loader.js"

// ---------------------------------------------------------------------------
// TF-IDF helpers
// ---------------------------------------------------------------------------

/** Tokenise a string into lowercase words, stripping punctuation. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
}

/** Build a term-frequency map from a token list. */
function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>()
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1)
  }
  // Normalise by document length
  for (const [k, v] of tf) {
    tf.set(k, v / tokens.length)
  }
  return tf
}

/** Compute IDF weights from a corpus of TF maps. */
function computeIdf(corpus: Map<string, number>[]): Map<string, number> {
  const N = corpus.length
  const df = new Map<string, number>()
  for (const doc of corpus) {
    for (const term of doc.keys()) {
      df.set(term, (df.get(term) ?? 0) + 1)
    }
  }
  const idf = new Map<string, number>()
  for (const [term, count] of df) {
    idf.set(term, Math.log((N + 1) / (count + 1)) + 1) // smoothed IDF
  }
  return idf
}

/** Build a TF-IDF vector (sparse, as a Map) for a document. */
function tfidfVector(tf: Map<string, number>, idf: Map<string, number>): Map<string, number> {
  const vec = new Map<string, number>()
  for (const [term, tfVal] of tf) {
    const idfVal = idf.get(term) ?? 1
    vec.set(term, tfVal * idfVal)
  }
  return vec
}

/** Cosine similarity between two sparse vectors. */
function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (const [term, aVal] of a) {
    dot += aVal * (b.get(term) ?? 0)
    normA += aVal * aVal
  }
  for (const bVal of b.values()) {
    normB += bVal * bVal
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// ---------------------------------------------------------------------------
// search_engine.py:15-194 — SkillSearchEngine class
// ---------------------------------------------------------------------------

export class SkillSearchEngine {
  /** search_engine.py:22 — model_name (kept for API parity) */
  readonly modelName: string

  /** search_engine.py:23 — skills list */
  skills: Skill[] = []

  /** TF maps per skill (replaces numpy embeddings matrix) */
  private tfMaps: Map<string, number>[] = []

  /** IDF weights computed over the indexed corpus */
  private idf: Map<string, number> = new Map()

  /** search_engine.py:29 — lock (JS is single-threaded; kept as no-op flag) */
  private _indexing = false

  // search_engine.py:32-47 — __init__()
  constructor(modelName: string) {
    logger.info({ modelName }, "Search engine initialized (TF-IDF, no external model)")
    this.modelName = modelName
  }

  // search_engine.py:49-61 — _ensure_model_loaded() → no-op for TF-IDF
  private _ensureModelLoaded(): void {
    // TF-IDF needs no model loading; method kept for structural parity
  }

  // search_engine.py:63-86 — index_skills()
  indexSkills(skills: Skill[]): void {
    if (!skills.length) {
      logger.warn("No skills to index")
      this.skills = []
      this.tfMaps = []
      this.idf = new Map()
      return
    }

    logger.info({ count: skills.length }, "Indexing skills...")
    this._ensureModelLoaded()

    this.skills = skills
    this.tfMaps = skills.map((s) => termFrequency(tokenize(s.description)))
    this.idf = computeIdf(this.tfMaps)

    logger.info({ count: skills.length }, "Successfully indexed skills")
  }

  // search_engine.py:88-119 — add_skills()
  addSkills(skills: Skill[]): void {
    if (!skills.length) return

    logger.info({ count: skills.length }, "Adding skills to index...")
    this._ensureModelLoaded()

    const newTfMaps = skills.map((s) => termFrequency(tokenize(s.description)))

    // Append to existing (search_engine.py:108-115)
    this.skills.push(...skills)
    this.tfMaps.push(...newTfMaps)

    // Recompute IDF over the full corpus
    this.idf = computeIdf(this.tfMaps)

    logger.info({ added: skills.length, total: this.skills.length }, "Added skills to index")
  }

  // search_engine.py:121-169 — search()
  search(query: string, topK = 3): Array<Record<string, unknown>> {
    if (!this.skills.length) {
      logger.warn("No skills indexed, returning empty results")
      return []
    }

    // Ensure top_k doesn't exceed available skills (search_engine.py:142)
    const k = Math.min(topK, this.skills.length)

    logger.info({ query, topK: k }, "Searching skills")

    // Generate TF-IDF vector for the query (search_engine.py:147-148)
    const queryTf = termFrequency(tokenize(query))
    const queryVec = tfidfVector(queryTf, this.idf)

    // Compute cosine similarity for each skill (search_engine.py:151)
    const scores = this.tfMaps.map((tf) => {
      const vec = tfidfVector(tf, this.idf)
      return this._cosineSimilarity(queryVec, vec)
    })

    // Get top-k indices sorted by descending score (search_engine.py:154)
    const indices = scores
      .map((score, idx) => ({ score, idx }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((x) => x.idx)

    // Build results (search_engine.py:157-168)
    const results: Array<Record<string, unknown>> = []
    for (const idx of indices) {
      const skill = this.skills[idx]!
      const score = scores[idx]!
      const result = skill.toDict()
      result["relevance_score"] = score
      results.push(result)
      logger.debug({ skillName: skill.name, score: score.toFixed(4) }, "Found skill")
    }

    logger.info({ count: results.length }, "Returning search results")
    return results
  }

  // Expose skills list for mcp-server.ts (mirrors search_engine.skills access in mcp_handlers.py:378,527)
  getSkills(): Skill[] {
    return this.skills
  }

  // search_engine.py:171-194 — _cosine_similarity() (sparse variant)
  private _cosineSimilarity(
    a: Map<string, number>,
    b: Map<string, number>,
  ): number {
    return cosineSimilarity(a, b)
  }
}
