export function formatJson(data: unknown): string {
  return JSON.stringify(data)
}

export function formatPretty(data: unknown): string {
  return JSON.stringify(data, null, 2)
}

export function formatTable(columns: string[], rows: Record<string, unknown>[]): string {
  if (columns.length === 0 || rows.length === 0) {
    return formatPretty({ columns, rows })
  }

  const colWidths: Record<string, number> = {}
  for (const c of columns) {
    colWidths[c] = c.length
  }

  const strRows: Record<string, string>[] = []
  for (const row of rows) {
    const sr: Record<string, string> = {}
    for (const c of columns) {
      const val = row[c]
      const s = val === null || val === undefined ? "" : String(val)
      sr[c] = s
      colWidths[c] = Math.max(colWidths[c], s.length)
    }
    strRows.push(sr)
  }

  const lines: string[] = []
  lines.push(columns.map((c) => c.padEnd(colWidths[c])).join(" | "))
  lines.push(columns.map((c) => "-".repeat(colWidths[c])).join("-+-"))
  for (const sr of strRows) {
    lines.push(columns.map((c) => (sr[c] ?? "").padEnd(colWidths[c])).join(" | "))
  }

  return lines.join("\n")
}

export function formatTableNoHeader(columns: string[], rows: Record<string, unknown>[]): string {
  if (columns.length === 0 || rows.length === 0) return ""
  const lines: string[] = []
  for (const row of rows) {
    lines.push(columns.map((c) => {
      const val = row[c]
      return val === null || val === undefined ? "" : String(val)
    }).join("\t"))
  }
  return lines.join("\n")
}

export function formatCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const lines: string[] = []
  lines.push(columns.map(csvEscape).join(","))
  for (const row of rows) {
    lines.push(
      columns
        .map((c) => {
          const val = row[c]
          if (val === null || val === undefined) return ""
          if (typeof val === "object") return csvEscape(JSON.stringify(val))
          return csvEscape(String(val))
        })
        .join(","),
    )
  }
  return lines.join("\n")
}

export function formatCsvNoHeader(columns: string[], rows: Record<string, unknown>[]): string {
  const lines: string[] = []
  for (const row of rows) {
    lines.push(
      columns
        .map((c) => {
          const val = row[c]
          if (val === null || val === undefined) return ""
          if (typeof val === "object") return csvEscape(JSON.stringify(val))
          return csvEscape(String(val))
        })
        .join(","),
    )
  }
  return lines.join("\n")
}

export function formatJsonl(rows: Record<string, unknown>[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n")
}

export function formatToon(data: unknown): string {
  return JSON.stringify(data)
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}
