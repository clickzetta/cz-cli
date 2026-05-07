/**
 * wildcard.ts — port of cz_mcp/common/wildcard_utils.py
 *
 * Python → TS mapping:
 *   wildcard_utils.py:11-21   contains_wildcard()           → containsWildcard()
 *   wildcard_utils.py:23-38   contains_regex_pattern()      → containsRegexPattern()
 *   wildcard_utils.py:40-87   convert_wildcard_to_regex()   → convertWildcardToRegex()
 *   wildcard_utils.py:89-103  convert_glob_to_regex()       → convertGlobToRegex()
 *   wildcard_utils.py:105-138 escape_filename_for_regexp()  → escapeFilenameForRegexp()
 *   wildcard_utils.py:140-185 get_volume_list_sql()         → getVolumeListSql()
 *
 * Divergences:
 *   - Python's fnmatch.translate is approximated with a simple glob→regex converter.
 *   - Python's loguru logger replaced by console.info.
 */

// wildcard_utils.py:11-21
export function containsWildcard(path: string): boolean {
  const wildcardPatterns = ["*", "?", "[", "]", "{", "}", "**"]
  return wildcardPatterns.some((p) => path.includes(p))
}

// wildcard_utils.py:23-38
export function containsRegexPattern(path: string): boolean {
  const regexPatterns = [".+", ".*", "\\d", "\\w", "\\s"]
  return regexPatterns.some((p) => path.includes(p))
}

// wildcard_utils.py:40-87
export function convertWildcardToRegex(wildcardPattern: string): string {
  let pattern = wildcardPattern

  // Handle **/ (recursive glob — equivalent to no directory restriction in Volume)
  pattern = pattern.replace(/\*\*\//g, "")

  // Handle {ext1,ext2} before escaping
  pattern = pattern.replace(/\{([^}]+)\}/g, (_match, inner: string) => {
    const options = inner.split(",").map((o) => o.trim())
    return `(${options.join("|")})`
  })

  // Replace wildcards with placeholders before escaping
  pattern = pattern.replace(/\*/g, "___STAR___").replace(/\?/g, "___QUESTION___")

  // Escape regex special chars
  pattern = pattern.replace(/[.^$+\[\]{}\\|]/g, (c) => `\\${c}`)

  // Restore wildcards as regex
  pattern = pattern.replace(/___STAR___/g, ".*").replace(/___QUESTION___/g, ".")

  // Unescape the brace-group chars we intentionally kept
  pattern = pattern.replace(/\\\(/g, "(").replace(/\\\)/g, ")").replace(/\\\|/g, "|")

  if (!pattern.endsWith("$")) {
    pattern = pattern + "$"
  }

  return pattern
}

// wildcard_utils.py:89-103 — simple glob→regex (approximates fnmatch.translate)
export function convertGlobToRegex(globPattern: string): string {
  let pattern = globPattern
    .replace(/[.^$+\[\]{}\\|]/g, (c) => `\\${c}`)
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  if (!pattern.startsWith("^")) pattern = "(?s:" + pattern
  if (!pattern.endsWith("$")) pattern = pattern + ")\\Z"
  return pattern
}

// wildcard_utils.py:105-138
export function escapeFilenameForRegexp(filename: string): string {
  const specialChars: Record<string, string> = {
    ".": "\\.",
    "^": "\\^",
    $: "\\$",
    "*": "\\*",
    "+": "\\+",
    "?": "\\?",
    "(": "\\(",
    ")": "\\)",
    "[": "\\[",
    "]": "\\]",
    "{": "\\{",
    "}": "\\}",
    "|": "\\|",
    "\\": "\\\\",
  }

  let escaped = ""
  for (const char of filename) {
    escaped += specialChars[char] ?? char
  }
  return escaped
}

// wildcard_utils.py:140-185
export function getVolumeListSql(volumeName: string, pattern: string): string {
  if (containsWildcard(pattern) || containsRegexPattern(pattern)) {
    let regexPattern: string
    if (containsRegexPattern(pattern)) {
      regexPattern = pattern
    } else {
      regexPattern = convertWildcardToRegex(pattern)
    }
    return `LIST VOLUME ${volumeName} REGEXP = '${regexPattern}'`
  }

  // No wildcard — distinguish directory vs file
  if (pattern === "." || pattern === "") {
    return `LIST VOLUME ${volumeName}`
  }
  if (pattern === "/") {
    return `LIST VOLUME ${volumeName}`
  }

  const basename = pattern.split("/").pop() ?? ""
  if (pattern.endsWith("/") || !basename.includes(".")) {
    // Directory path
    const dirPath = pattern.replace(/\/$/, "")
    if (dirPath === "") {
      return `LIST VOLUME ${volumeName}`
    }
    return `LIST VOLUME ${volumeName} SUBDIRECTORY '${dirPath}'`
  }

  // Specific filename — use REGEXP for exact match
  const escapedPattern = escapeFilenameForRegexp(pattern) + "$"
  return `LIST VOLUME ${volumeName} REGEXP = '${escapedPattern}'`
}
