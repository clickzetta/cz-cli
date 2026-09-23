import { SemanticViewError } from "./error.js"
import { createHash } from "node:crypto"
import { fields, type Model } from "./model.js"
import { identifier, rewriteReferences, sqlKeyword } from "./sql.js"

/** Native semantic WHERE resolves declared semantic fields, not arbitrary physical columns. */
export function materializeFilters(input: Model) {
  const model = structuredClone(input)
  const all = fields(model)
  const predicates = new Map<string, string>()
  for (const item of all.filter((f) => f.kind === "filters")) {
    const predicate = rewriteReferences(item.field.expr, (parts, call) => {
      if (call || (parts.length === 1 && sqlKeyword(parts[0]))) return undefined
      const owner = parts.length === 2 ? parts[0] : item.table
      const column = parts.length === 2 ? parts[1] : parts[0]
      const table = model.tables.find((t) => t.name === owner)
      if (!table || parts.length > 2) return undefined
      const existing = all.find((f) => f.table === owner && f.field.name === column && f.kind !== "filters")
      if (existing?.field.access_modifier !== "private_access" && existing)
        return [owner, column].map(identifier).join(".")
      if (existing?.field.access_modifier === "private_access")
        throw new SemanticViewError(
          "PRIVATE_FILTER_FIELD",
          `Named filter ${item.key} cannot expose private field ${existing.key}; define an explicit public predicate instead`,
        )
      const expr = existing?.field.expr ?? [owner, column].map(identifier).join(".")
      const name =
        "__cz_filter_" +
        createHash("sha256")
          .update(owner + "\0" + expr)
          .digest("hex")
          .slice(0, 12)
      if (!table.facts.some((f) => f.name === name))
        table.facts.push({
          name,
          expr,
          description: "CLI predicate support field",
          synonyms: [],
          using_relationships: [],
          non_additive_dimensions: [],
        })
      return [owner, name].map(identifier).join(".")
    })
    predicates.set(item.key, predicate)
  }
  return { model, predicates }
}
