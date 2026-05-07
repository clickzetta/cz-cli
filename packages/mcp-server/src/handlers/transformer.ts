/**
 * transformer.ts — line-by-line port of
 * cz-mcp-server/cz_mcp/handlers/transformer.py (471 lines)
 *
 * Python → TS mapping:
 *   transformer.py:1-15    Transformers.toInt          → Transformers.toInt
 *   transformer.py:17-26   Transformers.toFloat        → Transformers.toFloat
 *   transformer.py:28-39   Transformers.toBool         → Transformers.toBool
 *   transformer.py:41-57   Transformers.toBoolOrNone   → Transformers.toBoolOrNone
 *   transformer.py:59-64   Transformers.toUpper        → Transformers.toUpper
 *   transformer.py:66-71   Transformers.toLower        → Transformers.toLower
 *   transformer.py:73-78   Transformers.toString       → Transformers.toString
 *   transformer.py:80-85   Transformers.stripString    → Transformers.stripString
 *   transformer.py:87-92   Transformers.toIntOrNone    → Transformers.toIntOrNone
 *   transformer.py:94-123  Transformers.validateAndFixHandlerFormat → Transformers.validateAndFixHandlerFormat
 *   transformer.py:125-200 Transformers.normalizeObjectType         → Transformers.normalizeObjectType
 *   transformer.py:202-213 Transformers.toList                      → Transformers.toList
 *   transformer.py:215-228 Transformers.normalizeObjectTypeNoPlural → Transformers.normalizeObjectTypeNoPlural
 *   transformer.py:230-309 Transformers.parseFunctionParameters     → Transformers.parseFunctionParameters
 *   transformer.py:311-391 Transformers.parseTableColumns           → Transformers.parseTableColumns
 *   transformer.py:393-471 Transformers.parseResourceUris           → Transformers.parseResourceUris
 */

// transformer.py:1 — Transformers class
export class Transformers {
  // transformer.py:4-15 — to_int
  static toInt(value: unknown): number | null {
    if (value === null || value === undefined) return null
    if (typeof value === "number" && Number.isInteger(value)) return value
    if (typeof value === "string") return parseInt(value, 10)
    if (typeof value === "number") return Math.trunc(value)
    throw new Error(`Cannot convert ${value} to int`)
  }

  // transformer.py:17-26 — to_float
  static toFloat(value: unknown): number | null {
    if (value === null || value === undefined) return null
    if (typeof value === "number") return value
    if (typeof value === "string") return parseFloat(value)
    throw new Error(`Cannot convert ${value} to float`)
  }

  // transformer.py:28-39 — to_bool
  static toBool(value: unknown): boolean | null {
    if (value === null || value === undefined) return null
    if (typeof value === "boolean") return value
    if (typeof value === "string") {
      return ["true", "1", "yes", "on"].includes(value.toLowerCase())
    }
    if (typeof value === "number") return Boolean(value)
    throw new Error(`Cannot convert ${value} to bool`)
  }

  // transformer.py:41-57 — to_bool_or_none
  static toBoolOrNone(value: unknown): boolean | null {
    if (value === null || value === undefined) return null
    if (typeof value === "boolean") return value
    if (typeof value === "string") {
      if (["true", "1", "yes", "on"].includes(value.toLowerCase())) return true
      if (["false", "0", "no", "off"].includes(value.toLowerCase())) return false
      return null
    }
    if (typeof value === "number") return Boolean(value)
    return null
  }

  // transformer.py:59-64 — to_upper
  static toUpper(value: unknown): string | null {
    if (value === null || value === undefined) return null
    return String(value).toUpperCase()
  }

  // transformer.py:66-71 — to_lower
  static toLower(value: unknown): string | null {
    if (value === null || value === undefined) return null
    return String(value).toLowerCase()
  }

  // transformer.py:73-78 — to_string
  static toString(value: unknown): string | null {
    if (value === null || value === undefined) return null
    return String(value)
  }

  // transformer.py:80-85 — strip_string
  static stripString(value: unknown): string | null {
    if (value === null || value === undefined) return null
    return String(value).trim()
  }

  // transformer.py:87-92 — to_int_or_none
  static toIntOrNone(value: unknown): number | null {
    if (value === null || value === undefined) return null
    return Transformers.toInt(value)
  }

  // transformer.py:94-123 — validate_and_fix_handler_format
  static validateAndFixHandlerFormat(value: unknown): string | null {
    if (value === null || value === undefined) return null

    let v = String(value).trim()
    if (!v) return v

    // transformer.py:108-111 — no dot: infer module.class format
    if (!v.includes(".")) {
      const suggestedFormat = `${v}.${v}`
      return suggestedFormat
    }

    // transformer.py:113-116 — validate format correctness
    const parts = v.split(".")
    if (parts.length >= 2 && parts.every((p) => p.trim())) {
      return v
    }

    // transformer.py:118-123 — format incorrect, throw error
    throw new Error(
      `Handler格式错误: '${v}'\n` +
        `正确格式应为: 'module.class'，如 'my_function.MyFunction'\n` +
        `如果只有类名，请使用: '${v}.${v}'`,
    )
  }

  // transformer.py:125-200 — normalize_object_type
  static normalizeObjectType(value: unknown): string | null {
    if (value === null || value === undefined) return null

    // transformer.py:145-148 — convert to string and strip
    let v = String(value).trim()
    if (!v) return v

    // transformer.py:151-155 — handle camelCase: insert space before uppercase
    // In JS we replicate the Python regex: (?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])
    let camelSpaced = v
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")

    // transformer.py:158 — replace underscores with spaces
    let normalized = camelSpaced.replace(/_/g, " ")

    // transformer.py:161 — convert to uppercase
    normalized = normalized.toUpperCase()

    // transformer.py:164 — normalize multiple spaces to single space
    normalized = normalized.replace(/\s+/g, " ")

    // transformer.py:167 — strip leading/trailing whitespace
    normalized = normalized.trim()

    // transformer.py:169-199 — singular to plural mapping
    const singularToPluralMapping: Record<string, string> = {
      TABLE: "TABLES",
      VIEW: "VIEWS",
      SCHEMA: "SCHEMAS",
      FUNCTION: "FUNCTIONS",
      VOLUME: "VOLUMES",
      CONNECTION: "CONNECTIONS",
      VCLUSTER: "VCLUSTERS",
      JOB: "JOBS",
      PIPE: "PIPES",
      INDEX: "INDEXES",
      USER: "USERS",
      ROLE: "ROLES",
      GRANT: "GRANTS",
      SHARE: "SHARES",
      CATALOG: "CATALOGS",
      WORKSPACE: "WORKSPACES",
      "TABLE STREAM": "TABLE STREAMS",
      "DYNAMIC TABLE": "DYNAMIC TABLES",
      "MATERIALIZED VIEW": "MATERIALIZED VIEWS",
      "EXTERNAL TABLE": "EXTERNAL TABLES",
      "EXTERNAL SCHEMA": "EXTERNAL SCHEMAS",
      "EXTERNAL FUNCTION": "EXTERNAL FUNCTIONS",
    }

    // transformer.py:197-198 — if singular form, convert to plural
    if (normalized in singularToPluralMapping) {
      normalized = singularToPluralMapping[normalized]!
    }

    return normalized
  }

  // transformer.py:202-213 — to_list
  static toList(value: unknown): string[] | null {
    if (value === null || value === undefined) return null
    if (Array.isArray(value)) {
      const filtered = value.map((v) => String(v).trim()).filter((v) => v)
      return filtered
    }
    if (typeof value === "string") {
      const parts = value
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p)
      return parts.length > 0 ? parts : null
    }
    // transformer.py:212-213 — fallback: convert to string
    const s = String(value).trim()
    return s ? [s] : null
  }

  // transformer.py:215-228 — normalize_object_type_no_plural
  static normalizeObjectTypeNoPlural(value: unknown): string | null {
    if (value === null || value === undefined) return null
    let v = String(value).trim()
    if (!v) return v
    // transformer.py:225 — same camelCase logic as normalizeObjectType
    let camelSpaced = v
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    let normalized = camelSpaced.replace(/_/g, " ").toUpperCase()
    normalized = normalized.replace(/\s+/g, " ").trim()
    return normalized
  }

  // transformer.py:230-309 — parse_function_parameters
  static parseFunctionParameters(
    value: unknown,
  ): Array<{ name: string; type: string }> {
    if (value === null || value === undefined) return []

    // transformer.py:242-243 — already a list, return directly
    if (Array.isArray(value)) return value as Array<{ name: string; type: string }>

    // transformer.py:246-307 — string format: parse into list
    if (typeof value === "string") {
      let v = value.trim()
      if (!v) return []

      // transformer.py:256 — decode HTML entities (&lt; &gt; etc.)
      v = v
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")

      const parameters: Array<{ name: string; type: string }> = []
      // transformer.py:261-287 — split by comma respecting parens and angle brackets
      const paramParts: string[] = []
      let currentPart = ""
      let parenDepth = 0
      let angleDepth = 0

      for (const char of v) {
        if (char === "(") {
          parenDepth++
          currentPart += char
        } else if (char === ")") {
          parenDepth--
          currentPart += char
        } else if (char === "<") {
          angleDepth++
          currentPart += char
        } else if (char === ">") {
          angleDepth--
          currentPart += char
        } else if (char === "," && parenDepth === 0 && angleDepth === 0) {
          paramParts.push(currentPart.trim())
          currentPart = ""
        } else {
          currentPart += char
        }
      }

      // transformer.py:286-287 — add last part
      if (currentPart.trim()) paramParts.push(currentPart.trim())

      // transformer.py:289-305 — parse each param string
      for (const paramStr of paramParts) {
        const ps = paramStr.trim()
        if (!ps) continue

        // transformer.py:296 — regex: name TYPE
        const match = ps.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+(.+)$/)
        if (match) {
          const paramName = match[1]!
          const paramType = match[2]!.trim().toUpperCase()
          parameters.push({ name: paramName, type: paramType })
        } else {
          throw new Error(`无效的参数格式: '${ps}'. 期望格式: 'name TYPE'`)
        }
      }

      return parameters
    }

    throw new Error(
      `参数格式不支持: ${typeof value}. 支持字符串或列表格式`,
    )
  }

  // transformer.py:311-391 — parse_table_columns
  static parseTableColumns(
    value: unknown,
  ): Array<{ name: string; type: string }> {
    if (value === null || value === undefined) return []

    // transformer.py:323-324 — already a list, return directly
    if (Array.isArray(value)) return value as Array<{ name: string; type: string }>

    // transformer.py:327-389 — string format: parse into list
    if (typeof value === "string") {
      let v = value.trim()
      if (!v) return []

      // transformer.py:337-338 — decode HTML entities
      v = v
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")

      const columns: Array<{ name: string; type: string }> = []
      // transformer.py:343-369 — split by comma respecting parens and angle brackets
      const columnParts: string[] = []
      let currentPart = ""
      let parenDepth = 0
      let angleDepth = 0

      for (const char of v) {
        if (char === "(") {
          parenDepth++
          currentPart += char
        } else if (char === ")") {
          parenDepth--
          currentPart += char
        } else if (char === "<") {
          angleDepth++
          currentPart += char
        } else if (char === ">") {
          angleDepth--
          currentPart += char
        } else if (char === "," && parenDepth === 0 && angleDepth === 0) {
          columnParts.push(currentPart.trim())
          currentPart = ""
        } else {
          currentPart += char
        }
      }

      // transformer.py:368-369 — add last part
      if (currentPart.trim()) columnParts.push(currentPart.trim())

      // transformer.py:371-387 — parse each column string
      for (const colStr of columnParts) {
        const cs = colStr.trim()
        if (!cs) continue

        // transformer.py:378 — regex: column_name DATA_TYPE
        const match = cs.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+(.+)$/)
        if (match) {
          const columnName = match[1]!
          const columnType = match[2]!.trim().toUpperCase()
          columns.push({ name: columnName, type: columnType })
        } else {
          throw new Error(
            `无效的列定义格式: '${cs}'. 期望格式: 'column_name DATA_TYPE'`,
          )
        }
      }

      return columns
    }

    throw new Error(
      `列定义格式不支持: ${typeof value}. 支持字符串或列表格式`,
    )
  }

  // transformer.py:393-471 — parse_resource_uris
  static parseResourceUris(
    value: unknown,
  ): Array<{ type: string; uri: string }> {
    if (value === null || value === undefined) return []

    // transformer.py:402-403 — already a list, return directly
    if (Array.isArray(value)) return value as Array<{ type: string; uri: string }>

    // transformer.py:406-469 — string format
    if (typeof value === "string") {
      // transformer.py:410-411 — handle empty string
      if (!value.trim()) return []

      // transformer.py:414-429 — simple URI string (not JSON)
      if (!value.trim().startsWith("[") && !value.trim().startsWith("{")) {
        const uri = value.trim()
        let resourceType = "FILE"

        // transformer.py:422-427 — infer type from extension
        if (uri.endsWith(".zip")) {
          resourceType = "ARCHIVE"
        } else if (uri.endsWith(".jar")) {
          resourceType = "JAR"
        } else if (uri.endsWith(".py")) {
          resourceType = "FILE"
        }

        return [{ type: resourceType, uri }]
      }

      // transformer.py:431-468 — JSON parsing
      try {
        const parsed: unknown = JSON.parse(value)
        if (Array.isArray(parsed)) {
          // transformer.py:434-447 — validate and auto-infer type for each item
          for (const item of parsed as Array<Record<string, string>>) {
            if (typeof item !== "object" || item === null || !("uri" in item)) {
              throw new Error(`资源项必须包含'uri'字段: ${JSON.stringify(item)}`)
            }
            if (!("type" in item)) {
              const uri = item["uri"]!
              if (uri.endsWith(".zip")) item["type"] = "ARCHIVE"
              else if (uri.endsWith(".jar")) item["type"] = "JAR"
              else item["type"] = "FILE"
            }
          }
          return parsed as Array<{ type: string; uri: string }>
        } else if (typeof parsed === "object" && parsed !== null) {
          // transformer.py:448-460 — single object, wrap in array
          const item = parsed as Record<string, string>
          if (!("uri" in item)) {
            throw new Error("资源项必须包含'uri'字段")
          }
          if (!("type" in item)) {
            const uri = item["uri"]!
            if (uri.endsWith(".zip")) item["type"] = "ARCHIVE"
            else if (uri.endsWith(".jar")) item["type"] = "JAR"
            else item["type"] = "FILE"
          }
          return [item as { type: string; uri: string }]
        } else {
          throw new Error("JSON必须解析为数组或对象格式")
        }
      } catch (e) {
        // transformer.py:463-469 — JSON parse failure
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes("JSON") || msg.includes("Unexpected")) {
          throw new Error(
            `resource_uris格式错误。支持格式：\n` +
              `• JSON数组: '[{"type": "ARCHIVE", "uri": "volume://path/file.zip"}]'\n` +
              `• 简单URI: 'volume://path/file.zip'\n` +
              `• JSON对象: '{"type": "ARCHIVE", "uri": "volume://path/file.zip"}'\n` +
              `当前值: ${JSON.stringify(value)}`,
          )
        }
        throw e
      }
    }

    throw new Error(
      `resource_uris格式不支持: ${typeof value}. 支持JSON字符串、数组格式或简单URI字符串`,
    )
  }
}
