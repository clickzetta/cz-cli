/**
 * volume-file.ts — port of cz_mcp/common/volume_file_resolver.py
 *
 * Python → TS mapping:
 *   volume_file_resolver.py:17-26   VolumeFileResolver.__init__()              → constructor
 *   volume_file_resolver.py:28-60   resolve_file_paths()                       → resolveFilePaths()
 *   volume_file_resolver.py:62-100  _resolve_with_pattern_matching()           → _resolveWithPatternMatching()
 *   volume_file_resolver.py:102-155 _resolve_with_direct_path()                → _resolveWithDirectPath()
 *   volume_file_resolver.py:157-255 _extract_file_paths_from_result()          → _extractFilePathsFromResult()
 *
 * Divergences:
 *   - Python's db_connection.execute_query returns (data, data_id); TS returns
 *     Promise<[Array<Record<string, unknown>>, string]> — same shape.
 *   - Python handles pandas DataFrame; TS only handles Array<Record<string,unknown>>.
 *   - Python's loguru logger replaced by console.info/warn/error.
 */

import {
  containsWildcard,
  containsRegexPattern,
  getVolumeListSql,
  convertWildcardToRegex,
} from "./wildcard.js"

export interface ResolveDetails {
  volumeName: string
  originalPath: string
  hasWildcard: boolean
  hasRegex: boolean
  resolutionMethod: string
  sqlExecuted?: string
  queryDataId?: string
  filesFound?: number
  patternUsed?: string
  targetType?: string
  warning?: string
  error?: string
  errorType?: string
  resultType?: string
  resultLength?: number
  pathColumnUsed?: string
  fallbackToFirstColumn?: boolean
  extractedFilesCount?: number
  sampleFiles?: string[]
  extractionError?: string
  resultAnalysis?: string
}

/** Minimal interface for the DB connection used by VolumeFileResolver */
export interface DbConnection {
  executeQuery(sql: string): Promise<[Array<Record<string, unknown>>, string]>
}

// volume_file_resolver.py:17-26
export class VolumeFileResolver {
  private readonly db: DbConnection

  constructor(dbConnection: DbConnection) {
    this.db = dbConnection
  }

  // volume_file_resolver.py:28-60
  async resolveFilePaths(
    volumeName: string,
    documentsSourcePath: string,
  ): Promise<[string[], ResolveDetails]> {
    console.info(`开始解析Volume文件路径: ${volumeName}/${documentsSourcePath}`)

    const hasWildcard = containsWildcard(documentsSourcePath)
    const hasRegex = containsRegexPattern(documentsSourcePath)

    const resolveDetails: ResolveDetails = {
      volumeName,
      originalPath: documentsSourcePath,
      hasWildcard,
      hasRegex,
      resolutionMethod: "unknown",
    }

    if (hasWildcard || hasRegex) {
      return this._resolveWithPatternMatching(volumeName, documentsSourcePath, resolveDetails)
    } else {
      return this._resolveWithDirectPath(volumeName, documentsSourcePath, resolveDetails)
    }
  }

  // volume_file_resolver.py:62-100
  private async _resolveWithPatternMatching(
    volumeName: string,
    pattern: string,
    resolveDetails: ResolveDetails,
  ): Promise<[string[], ResolveDetails]> {
    resolveDetails.resolutionMethod = "pattern_matching"

    try {
      const sql = getVolumeListSql(volumeName, pattern)
      resolveDetails.sqlExecuted = sql

      console.info(`执行模式匹配查询: ${sql}`)

      const [data, dataId] = await this.db.executeQuery(sql)
      resolveDetails.queryDataId = dataId

      const filePaths = this._extractFilePathsFromResult(data, resolveDetails)

      resolveDetails.filesFound = filePaths.length
      resolveDetails.patternUsed = containsWildcard(pattern)
        ? convertWildcardToRegex(pattern)
        : pattern

      console.info(`模式匹配找到 ${filePaths.length} 个文件`)

      if (filePaths.length === 0) {
        console.warn(`模式 '${pattern}' 在Volume '${volumeName}' 中未找到匹配文件`)
        resolveDetails.warning = `模式 '${pattern}' 未找到匹配文件`
      }

      return [filePaths, resolveDetails]
    } catch (e) {
      console.error(`模式匹配查询失败: ${e}`)
      resolveDetails.error = String(e)
      resolveDetails.errorType = "pattern_matching_failed"
      return [[], resolveDetails]
    }
  }

  // volume_file_resolver.py:102-155
  private async _resolveWithDirectPath(
    volumeName: string,
    path: string,
    resolveDetails: ResolveDetails,
  ): Promise<[string[], ResolveDetails]> {
    resolveDetails.resolutionMethod = "direct_path"

    try {
      const sql = getVolumeListSql(volumeName, path)

      const basename = path.split("/").pop() ?? ""
      if (path === "." || path === "") {
        resolveDetails.targetType = "list_all"
      } else if (path.endsWith("/") || !basename.includes(".")) {
        resolveDetails.targetType = "directory"
      } else {
        resolveDetails.targetType = "file"
      }

      resolveDetails.sqlExecuted = sql
      console.info(`执行直接路径查询: ${sql}`)

      const [data, dataId] = await this.db.executeQuery(sql)
      resolveDetails.queryDataId = dataId

      const filePaths = this._extractFilePathsFromResult(data, resolveDetails)
      resolveDetails.filesFound = filePaths.length

      if (resolveDetails.targetType === "file") {
        if (filePaths.length > 0) {
          console.info(`文件存在验证成功: 找到 ${filePaths.length} 个匹配文件`)
          return [filePaths, resolveDetails]
        } else {
          console.warn(`文件 '${path}' 在Volume '${volumeName}' 中不存在`)
          resolveDetails.warning = `文件 '${path}' 不存在`
          return [[], resolveDetails]
        }
      } else if (resolveDetails.targetType === "list_all") {
        console.info(`列出Volume中所有文件: 找到 ${filePaths.length} 个文件`)
        return [filePaths, resolveDetails]
      } else if (resolveDetails.targetType === "directory") {
        console.info(`目录 '${path}' 中找到 ${filePaths.length} 个文件`)
        return [filePaths, resolveDetails]
      } else {
        if (filePaths.length > 0) {
          return [filePaths, resolveDetails]
        } else {
          console.warn(`路径 '${path}' 在Volume '${volumeName}' 中未找到匹配内容`)
          resolveDetails.warning = `路径 '${path}' 未找到匹配内容`
          return [[], resolveDetails]
        }
      }
    } catch (e) {
      console.error(`直接路径查询失败: ${e}`)
      resolveDetails.error = String(e)
      resolveDetails.errorType = "direct_path_failed"
      return [[], resolveDetails]
    }
  }

  // volume_file_resolver.py:157-255
  private _extractFilePathsFromResult(
    queryResult: Array<Record<string, unknown>> | null | undefined,
    resolveDetails: ResolveDetails,
  ): string[] {
    const filePaths: string[] = []

    try {
      if (queryResult == null) {
        resolveDetails.resultAnalysis = "query_result_is_none"
        return filePaths
      }

      if (Array.isArray(queryResult) && queryResult.length > 0) {
        resolveDetails.resultType = "list"
        resolveDetails.resultLength = queryResult.length

        const pathKeys = ["relative_path", "path", "file_path", "name", "filename"]

        for (const item of queryResult) {
          if (typeof item === "object" && item !== null) {
            let found = false
            for (const key of pathKeys) {
              if (key in item && typeof item[key] === "string") {
                filePaths.push(item[key] as string)
                if (!resolveDetails.pathColumnUsed) {
                  resolveDetails.pathColumnUsed = key
                }
                found = true
                break
              }
            }
            if (!found) {
              // Fallback: use first string value
              for (const value of Object.values(item)) {
                if (typeof value === "string" && value.trim()) {
                  filePaths.push(value)
                  resolveDetails.fallbackToFirstColumn = true
                  break
                }
              }
            }
          } else if (typeof item === "string") {
            filePaths.push(item)
          }
        }
      } else {
        resolveDetails.resultAnalysis = `unsupported_result_type: ${typeof queryResult}`
      }

      // Deduplicate while preserving order, filter empty
      const seen = new Set<string>()
      const deduped: string[] = []
      for (const p of filePaths) {
        const trimmed = p.trim()
        if (trimmed && !seen.has(trimmed)) {
          seen.add(trimmed)
          deduped.push(trimmed)
        }
      }

      resolveDetails.extractedFilesCount = deduped.length
      if (deduped.length > 0) {
        resolveDetails.sampleFiles = deduped.slice(0, 5)
      }

      return deduped
    } catch (e) {
      console.error(`提取文件路径时出错: ${e}`)
      resolveDetails.extractionError = String(e)
      return filePaths
    }
  }
}
