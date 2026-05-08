/**
 * sql-intelligence.ts — port of cz_mcp/query/sql_intelligence.py
 * SQL error analysis and friendly suggestions for ClickZetta.
 */

export interface SqlErrorAnalysis {
  original_error: string
  friendly_message: string
  suggestions: string[]
  error_type: string
}

export class SQLIntelligence {
  static analyzeSqlError(errorMsg: string, sql = ""): SqlErrorAnalysis {
    const result: SqlErrorAnalysis = {
      original_error: errorMsg,
      friendly_message: "",
      suggestions: [],
      error_type: "sql_execution_failed",
    }

    if (SQLIntelligence._isImplicitCastSemanticError(errorMsg)) {
      result.friendly_message = "SQL语义分析错误：字段类型不兼容，无法隐式转换"
      result.error_type = "sql_semantic_analysis_error"
      result.suggestions = SQLIntelligence._buildImplicitCastSuggestions(errorMsg)
      return result
    }

    const syntaxFixes = SQLIntelligence._checkClickzettaSyntax(errorMsg, sql)
    if (syntaxFixes.length) result.suggestions.push(...syntaxFixes)

    result.suggestions.push(
      "如果当前错误是语法问题，使用 get_product_knowledge 工具获取Lakehouse 语法方言用于改写SQL",
    )
    return result
  }

  private static _isImplicitCastSemanticError(errorMsg: string): boolean {
    const lower = (errorMsg ?? "").toLowerCase()
    return lower.includes("semantic analysis exception") && lower.includes("implicit cast not allowed")
  }

  private static _buildImplicitCastSuggestions(errorMsg: string): string[] {
    const suggestions = [
      "请检查SQL字段类型，避免依赖隐式类型转换。",
      "请对不兼容字段使用显式 CAST(...) 转换后再写入目标表。",
    ]
    const match = (errorMsg ?? "").match(
      /implicit cast not allowed for '([^']+)':\s*([^:]+?)\s+to\s+([a-zA-Z0-9_]+)/i,
    )
    if (match) {
      const [, col, srcType, tgtType] = match
      suggestions.splice(
        2, 0,
        `示例修复：将 \`${col.trim()}\` 从 \`${srcType.trim()}\` 显式转换为 \`${tgtType.trim()}\`，如 \`CAST(${col.trim()} AS ${tgtType.trim()})\`。`,
      )
    }
    return suggestions
  }

  private static _checkClickzettaSyntax(errorMsg: string, _sql: string): string[] {
    const suggestions: string[] = []
    const lower = errorMsg.toLowerCase()
    if (lower.includes("identity column type int")) suggestions.push("IDENTITY列必须使用BIGINT类型")
    if (lower.includes("permission denied")) suggestions.push("检查访问权限或联系管理员")
    return suggestions
  }

  static beautifyErrorMessage(rawError: string): string {
    const lower = rawError.toLowerCase()
    if (lower.includes("identity column type int")) return "IDENTITY列类型错误：必须使用BIGINT而不是INT"
    if (lower.includes("syntax error")) return "SQL语法错误"
    if (lower.includes("parse error")) return "SQL解析错误"
    if (lower.includes("table") && (lower.includes("not found") || lower.includes("not exist") || lower.includes("does not exist"))) return "表不存在"
    if (lower.includes("column") && lower.includes("not found")) return "列不存在"
    if (lower.includes("permission denied") || lower.includes("access denied")) return "权限不足"
    if (lower.includes("type") && lower.includes("cannot")) return "数据类型错误"
    if (lower.includes("connection") || lower.includes("timeout")) return "连接超时"
    return `执行失败: ${rawError.slice(0, 500)}${rawError.length > 500 ? "..." : ""}`
  }

  static getHelpfulHints(sql: string, context?: Record<string, unknown>): string[] {
    const hints: string[] = []
    const upper = sql.toUpperCase()
    if (upper.includes("CREATE TABLE")) {
      hints.push("💡 建议：为大表考虑添加适当的分区策略")
      if (!upper.includes("IDENTITY")) hints.push("💡 建议：考虑添加IDENTITY主键列")
    } else if (upper.includes("INSERT INTO")) {
      if (upper.includes("VALUES") && (sql.match(/VALUES/gi) ?? []).length === 1)
        hints.push("💡 建议：批量插入使用多个VALUES子句可提升性能")
    } else if (upper.includes("SELECT")) {
      if (sql.includes("*") && !upper.includes("LIMIT"))
        hints.push("💡 建议：大表查询建议添加LIMIT子句限制结果数量")
    }
    if (upper.includes("ORDER BY") && !upper.includes("LIMIT"))
      hints.push("💡 性能提示：ORDER BY配合LIMIT使用效果更佳")
    if (context?.["is_large_table"])
      hints.push("💡 性能提示：大表查询建议使用WHERE条件过滤数据")
    return hints
  }
}

export const sqlIntelligence = SQLIntelligence
