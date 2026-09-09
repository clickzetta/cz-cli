import { scanSql } from "./scan.js"

/** Split at unquoted semicolons, sharing the readonly checker's lexical rules. */
export function splitSql(query: string): string[] {
  return scanSql(query).statements.map((item) => item.sql)
}
