/**
 * utilities.ts — port of cz_mcp/common/utilities.py (1024 lines)
 * Placeholder with convertDfToDict stub; full implementation pending.
 */

/** data_utils.py:347-352 convert_df_to_dict — convert a DataFrame-like to dict list */
export function convertDfToDict(df: unknown): Record<string, unknown>[] {
  if (Array.isArray(df)) return df as Record<string, unknown>[]
  return []
}
