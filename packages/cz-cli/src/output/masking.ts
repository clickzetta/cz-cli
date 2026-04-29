export function maskRows(
  columns: string[],
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const sensitivePattern =
    /^(password|passwd|secret|api_key|apikey|token|access_token|refresh_token|private_key)$/i

  const sensitiveIndices = new Set<number>()
  for (let i = 0; i < columns.length; i++) {
    if (sensitivePattern.test(columns[i])) {
      sensitiveIndices.add(i)
    }
  }

  if (sensitiveIndices.size === 0) return rows

  return rows.map((row) => {
    const masked = { ...row }
    for (const idx of sensitiveIndices) {
      const col = columns[idx]
      if (col in masked && masked[col] !== null && masked[col] !== undefined) {
        masked[col] = "******"
      }
    }
    return masked
  })
}
