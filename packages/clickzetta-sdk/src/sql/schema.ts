/**
 * Schema types ported from clickzetta/connector/v0/schema.py.
 * Provides SchemaField class and helpers.
 */

import type { StandardSqlField } from "./standard-sql.js"
import { StandardSqlDataType, StandardSqlTypeNames } from "./standard-sql.js"

const STRUCT_TYPES = new Set(["MAP", "STRUCT", "ARRAY"])

export const LEGACY_TO_STANDARD_TYPES: Record<string, StandardSqlTypeNames> = {
  STRING: StandardSqlTypeNames.STRING,
  BINARY: StandardSqlTypeNames.BINARY,
  INT8: StandardSqlTypeNames.INT8,
  INT16: StandardSqlTypeNames.INT16,
  FLOAT32: StandardSqlTypeNames.FLOAT32,
  FLOAT64: StandardSqlTypeNames.FLOAT64,
  INT32: StandardSqlTypeNames.INT32,
  INT64: StandardSqlTypeNames.INT64,
  BOOL: StandardSqlTypeNames.BOOL,
  MAP: StandardSqlTypeNames.MAP,
  ARRAY: StandardSqlTypeNames.ARRAY,
  STRUCT: StandardSqlTypeNames.STRUCT,
  TIMESTAMP: StandardSqlTypeNames.TIMESTAMP,
  DATE: StandardSqlTypeNames.DATE,
  DECIMAL: StandardSqlTypeNames.DECIMAL,
  VARCHAR: StandardSqlTypeNames.VARCHAR,
  CHAR: StandardSqlTypeNames.CHAR,
}

export interface SchemaFieldInit {
  name: string
  fieldType: string
  mode?: string
  description?: string
  fields?: SchemaField[]
  precision?: number
  scale?: number
  maxLength?: number
}

export class SchemaField {
  private _properties: Record<string, unknown>
  private _fields: SchemaField[]

  constructor(init: SchemaFieldInit) {
    this._properties = {
      name: init.name,
      type: init.fieldType,
    }
    if (init.mode !== undefined) this._properties.mode = init.mode.toUpperCase()
    else this._properties.mode = "NULLABLE"
    if (init.description !== undefined) this._properties.description = init.description
    if (init.precision !== undefined) this._properties.precision = init.precision
    if (init.scale !== undefined) this._properties.scale = init.scale
    if (init.maxLength !== undefined) this._properties.maxLength = init.maxLength
    this._fields = init.fields ? [...init.fields] : []
  }

  static fromApiRepr(repr: Record<string, unknown>): SchemaField {
    const fieldType = (repr.type as string).toUpperCase()
    const mode = ((repr.mode as string) || "NULLABLE").toUpperCase()
    const description = repr.description as string | undefined
    const rawFields = (repr.fields as Record<string, unknown>[]) || []
    const fields = rawFields.map(f => SchemaField.fromApiRepr(f))

    return new SchemaField({
      name: repr.name as string,
      fieldType,
      mode,
      description,
      fields,
      precision: repr.precision != null ? Number(repr.precision) : undefined,
      scale: repr.scale != null ? Number(repr.scale) : undefined,
      maxLength: repr.maxLength != null ? Number(repr.maxLength) : undefined,
    })
  }

  get name(): string { return this._properties.name as string }
  get fieldType(): string { return this._properties.type as string }
  get mode(): string { return (this._properties.mode as string) || "NULLABLE" }
  get isNullable(): boolean { return this.mode === "NULLABLE" }
  get description(): string | undefined { return this._properties.description as string | undefined }
  get precision(): number | undefined { return this._properties.precision as number | undefined }
  get scale(): number | undefined { return this._properties.scale as number | undefined }
  get maxLength(): number | undefined { return this._properties.maxLength as number | undefined }
  get fields(): SchemaField[] { return this._fields }

  toApiRepr(): Record<string, unknown> {
    const answer = { ...this._properties }
    if (STRUCT_TYPES.has(this.fieldType.toUpperCase())) {
      answer.fields = this._fields.map(f => f.toApiRepr())
    }
    return answer
  }

  toStandardSql(): StandardSqlField {
    const sqlType = new StandardSqlDataType(
      LEGACY_TO_STANDARD_TYPES[this.fieldType] ?? StandardSqlTypeNames.TYPE_KIND_UNSPECIFIED,
    )
    return { name: this.name, type: sqlType }
  }

  equals(other: unknown): boolean {
    if (!(other instanceof SchemaField)) return false
    return this.name === other.name && this.fieldType === other.fieldType && this.mode === other.mode
  }
}

/** Parse a schema resource (array of field descriptors) into SchemaField[]. */
export function parseSchemaResource(info: Record<string, unknown>): SchemaField[] {
  const fields = (info.fields as Record<string, unknown>[]) || []
  return fields.map(f => SchemaField.fromApiRepr(f))
}

/** Build a schema resource from SchemaField[]. */
export function buildSchemaResource(fields: SchemaField[]): Record<string, unknown>[] {
  return fields.map(f => f.toApiRepr())
}

/** Normalize schema items to SchemaField[]. */
export function toSchemaFields(schema: (SchemaField | Record<string, unknown>)[]): SchemaField[] {
  return schema.map(field => {
    if (field instanceof SchemaField) return field
    return SchemaField.fromApiRepr(field as Record<string, unknown>)
  })
}
