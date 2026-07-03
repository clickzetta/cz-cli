/**
 * Standard SQL types ported from clickzetta/connector/v0/standard_sql.py.
 * Provides StandardSqlDataType, StandardSqlField, StandardSqlTableType.
 */

export enum StandardSqlTypeNames {
  TYPE_KIND_UNSPECIFIED = "TYPE_KIND_UNSPECIFIED",
  INT8 = "INT8",
  INT16 = "INT16",
  INT32 = "INT32",
  INT64 = "INT64",
  FLOAT32 = "FLOAT32",
  FLOAT64 = "FLOAT64",
  DECIMAL = "DECIMAL",
  BOOL = "BOOL",
  STRING = "STRING",
  BINARY = "BINARY",
  CHAR = "CHAR",
  VARCHAR = "VARCHAR",
  TIMESTAMP = "TIMESTAMP",
  DATE = "DATE",
  MAP = "MAP",
  ARRAY = "ARRAY",
  STRUCT = "STRUCT",
}

export class StandardSqlDataType {
  private _properties: Record<string, unknown> = {}

  constructor(typeKind: StandardSqlTypeNames = StandardSqlTypeNames.TYPE_KIND_UNSPECIFIED) {
    this.typeKind = typeKind
  }

  get typeKind(): StandardSqlTypeNames {
    const kind = this._properties.typeKind as string
    return (StandardSqlTypeNames as Record<string, StandardSqlTypeNames>)[kind] ?? StandardSqlTypeNames.TYPE_KIND_UNSPECIFIED
  }

  set typeKind(value: StandardSqlTypeNames) {
    this._properties.typeKind = value ?? StandardSqlTypeNames.TYPE_KIND_UNSPECIFIED
  }

  toApiRepr(): Record<string, unknown> {
    return { ...this._properties }
  }

  static fromApiRepr(resource: Record<string, unknown>): StandardSqlDataType {
    const typeKind = resource.typeKind as string
    const resolved = (StandardSqlTypeNames as Record<string, StandardSqlTypeNames>)[typeKind]
      ?? StandardSqlTypeNames.TYPE_KIND_UNSPECIFIED
    return new StandardSqlDataType(resolved)
  }

  equals(other: unknown): boolean {
    if (!(other instanceof StandardSqlDataType)) return false
    return this.typeKind === other.typeKind
  }

  toString(): string {
    return `StandardSqlDataType(typeKind=${this.typeKind})`
  }
}

export interface StandardSqlField {
  name?: string
  type?: StandardSqlDataType
}

export function createStandardSqlField(name?: string, type?: StandardSqlDataType): StandardSqlField {
  return { name, type }
}

export function standardSqlFieldToApiRepr(field: StandardSqlField): Record<string, unknown> {
  return {
    name: field.name ?? null,
    type: field.type?.toApiRepr() ?? null,
  }
}

export function standardSqlFieldFromApiRepr(resource: Record<string, unknown>): StandardSqlField {
  const typeRepr = (resource.type as Record<string, unknown>) ?? {}
  return {
    name: resource.name as string | undefined,
    type: StandardSqlDataType.fromApiRepr(typeRepr),
  }
}

export class StandardSqlTableType {
  private _properties: Record<string, unknown>

  constructor(columns: StandardSqlField[]) {
    this._properties = {
      columns: columns.map(col => standardSqlFieldToApiRepr(col)),
    }
  }

  get columns(): StandardSqlField[] {
    const raw = (this._properties.columns as Record<string, unknown>[]) || []
    return raw.map(r => standardSqlFieldFromApiRepr(r))
  }

  set columns(value: StandardSqlField[]) {
    this._properties.columns = value.map(col => standardSqlFieldToApiRepr(col))
  }

  toApiRepr(): Record<string, unknown> {
    return { ...this._properties }
  }

  static fromApiRepr(resource: Record<string, unknown>): StandardSqlTableType {
    const rawColumns = (resource.columns as Record<string, unknown>[]) || []
    const columns = rawColumns.map(col => {
      const typeRepr = (col.type as Record<string, unknown>) ?? {}
      return {
        name: col.name as string | undefined,
        type: StandardSqlDataType.fromApiRepr(typeRepr),
      }
    })
    return new StandardSqlTableType(columns)
  }

  equals(other: unknown): boolean {
    if (!(other instanceof StandardSqlTableType)) return false
    const a = this.columns
    const b = other.columns
    if (a.length !== b.length) return false
    return a.every((col, i) => col.name === b[i].name && (col.type?.equals(b[i].type) ?? col.type === b[i].type))
  }
}
