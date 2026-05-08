/**
 * semantic-view-query.ts — port of cz_mcp/query/semantic_view_query.py
 */

export interface SVQueryDimensionFilter {
  logical_table: string
  dimension_name: string
  expression: string
}

export interface SVQueryDimension {
  logical_table: string
  dimension_name: string
  alias: string
}

export interface SVQuery {
  semantic_view: string
  dimensions: SVQueryDimension[]
  filters: SVQueryDimensionFilter[]
  metrics: string[]
  order_by: string[]
  order_asc: boolean
  limit: number | null
}

export function svQueryToSql(query: SVQuery): string {
  let sql = `SELECT * FROM SEMANTIC_VIEW(\n    ${query.semantic_view}\n`
  if (query.dimensions.length > 0) {
    sql += "    DIMENSIONS " + query.dimensions.map((d) => `${d.logical_table}.${d.dimension_name}`).join(", ") + "\n"
  }
  if (query.metrics.length > 0) {
    sql += "    METRICS " + query.metrics.join(", ") + "\n"
  }
  if (query.filters.length > 0) {
    sql += "    WHERE " + query.filters.map((f) => f.expression).join(" AND ") + "\n"
  }
  sql += ")"
  if (query.order_by.length > 0) {
    const order = query.order_asc ? "ASC" : "DESC"
    sql += " ORDER BY " + query.order_by.join(", ") + ` ${order}`
  }
  if (query.limit != null) sql += ` LIMIT ${query.limit}`
  sql += ";"
  return sql
}

export function parseSvQueryInput(inputData: Record<string, unknown>): SVQuery {
  // Parse dimensions
  const dimensions: SVQueryDimension[] = []
  if (inputData["dimensions"]) {
    for (const dim of inputData["dimensions"] as unknown[]) {
      if (typeof dim === "object" && dim !== null) {
        const d = dim as Record<string, unknown>
        dimensions.push({
          logical_table: (d["logical_table"] as string) ?? "",
          dimension_name: (d["dimension_name"] as string) ?? "",
          alias: (d["alias"] as string) ?? "",
        })
      } else if (typeof dim === "string") {
        const match = dim.match(/(?:(\w+)\.)?(\w+)(?:\s+AS\s+(\w+))?/i)
        if (match) {
          dimensions.push({
            logical_table: match[1] ?? "",
            dimension_name: match[2] ?? "",
            alias: match[3] ?? "",
          })
        }
      }
    }
  }

  // Parse filters
  const filters: SVQueryDimensionFilter[] = []
  if (inputData["filters"]) {
    for (const filt of inputData["filters"] as unknown[]) {
      if (typeof filt === "object" && filt !== null) {
        const f = filt as Record<string, unknown>
        filters.push({
          logical_table: (f["logical_table"] as string) ?? "",
          dimension_name: (f["dimension_name"] as string) ?? "",
          expression: (f["expression"] as string) ?? "",
        })
      } else if (typeof filt === "string") {
        const match = filt.match(/(?:(\w+)\.)?(\w+)\s+(.+)/)
        if (match) {
          filters.push({
            logical_table: match[1] ?? "",
            dimension_name: match[2] ?? "",
            expression: match[3] ?? "",
          })
        }
      }
    }
  }

  // Parse metrics
  let metrics = (inputData["metrics"] ?? []) as string[] | string
  if (typeof metrics === "string") metrics = metrics.split(",").map((m) => m.trim())

  return {
    semantic_view: inputData["semantic_view"] as string,
    dimensions,
    filters,
    metrics,
    order_by: (inputData["order_by"] as string[]) ?? [],
    order_asc: (inputData["order_asc"] as boolean) ?? true,
    limit: (inputData["limit"] as number | null) ?? null,
  }
}

export function svQueryAddDimension(query: SVQuery, dimension: SVQueryDimension): SVQuery {
  query.dimensions.push(dimension)
  return query
}

export function svQueryAddFilter(query: SVQuery, filter: SVQueryDimensionFilter): SVQuery {
  query.filters.push(filter)
  return query
}

export function svQueryDeleteDimension(query: SVQuery, dimensionName: string): SVQuery {
  query.dimensions = query.dimensions.filter((d) => d.dimension_name !== dimensionName)
  return query
}

export function svQueryDeleteFilter(query: SVQuery, dimensionName: string): SVQuery {
  query.filters = query.filters.filter((f) => f.dimension_name !== dimensionName)
  return query
}

export function svQuerySetLimit(query: SVQuery, limit: number): SVQuery {
  query.limit = limit
  return query
}

export function svQuerySetOrder(query: SVQuery, orderBy: string[], orderAsc: boolean): SVQuery {
  query.order_by = orderBy
  query.order_asc = orderAsc
  return query
}

export function svQuerySetMetrics(query: SVQuery, metrics: string[]): SVQuery {
  query.metrics = metrics
  return query
}

export function svQueryAddMetrics(query: SVQuery, metrics: string[]): SVQuery {
  query.metrics.push(...metrics)
  return query
}

export function svQueryDeleteMetric(query: SVQuery, metricName: string): SVQuery {
  query.metrics = query.metrics.filter((m) => m !== metricName)
  return query
}
