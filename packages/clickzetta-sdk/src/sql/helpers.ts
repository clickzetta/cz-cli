/**
 * Shared helper functions ported from clickzetta/connector/v0/_helpers.py.
 * JSON/type conversion helpers for ClickZetta API.
 */

import type { SchemaField } from "./schema.js"

const UTC_OFFSET = 0
const EPOCH = new Date(Date.UTC(1970, 0, 1))
const RFC3339_MICROS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/

// ─── From JSON converters ────────────────────────────────────────────────────

function notNull(value: unknown, field?: { mode?: string }): boolean {
  return value != null || (field != null && field.mode !== "NULLABLE")
}

export function intFromJson(value: unknown, field?: { mode?: string }): number | undefined {
  if (notNull(value, field)) return Number(value)
  return undefined
}

export function floatFromJson(value: unknown, field?: { mode?: string }): number | undefined {
  if (notNull(value, field)) return Number(value)
  return undefined
}

export function decimalFromJson(value: unknown, field?: { mode?: string }): string | undefined {
  if (notNull(value, field)) return String(value)
  return undefined
}

export function boolFromJson(value: unknown, field?: { mode?: string }): boolean | undefined {
  if (notNull(value, field)) {
    const s = String(value).toLowerCase()
    return s === "t" || s === "true" || s === "1"
  }
  return undefined
}

export function stringFromJson(value: unknown, _field?: unknown): string | undefined {
  return value as string | undefined
}

export function bytesFromJson(value: unknown, field?: { mode?: string }): Buffer | undefined {
  if (notNull(value, field)) {
    return Buffer.from(String(value), "base64")
  }
  return undefined
}

export function timestampFromJson(value: unknown, field?: { mode?: string }): Date | undefined {
  if (notNull(value, field)) {
    // Value is microseconds since epoch
    const us = Number(value)
    return new Date(EPOCH.getTime() + us / 1000)
  }
  return undefined
}

export function dateFromJson(value: unknown, field?: { mode?: string }): string | undefined {
  if (notNull(value, field)) return String(value)
  return undefined
}

type CellConverter = (value: unknown, field?: { mode?: string }) => unknown

const CELLDATA_FROM_JSON: Record<string, CellConverter> = {
  INT8: intFromJson,
  INT16: intFromJson,
  INT32: intFromJson,
  INT64: intFromJson,
  FLOAT32: floatFromJson,
  FLOAT64: floatFromJson,
  DECIMAL: decimalFromJson,
  BOOL: boolFromJson,
  STRING: stringFromJson,
  VARCHAR: stringFromJson,
  CHAR: stringFromJson,
  BINARY: bytesFromJson,
  TIMESTAMP: timestampFromJson,
  DATE: dateFromJson,
}

export function fieldFromJson(resource: unknown, field: SchemaField): unknown {
  const converter = CELLDATA_FROM_JSON[field.fieldType] ?? ((v: unknown) => v)
  if (field.mode === "REPEATED") {
    return (resource as { v: unknown }[]).map(item => converter(item.v, field))
  }
  return converter(resource, field)
}

export function rowTupleFromJson(row: { f: { v: unknown }[] }, schema: SchemaField[]): unknown[] {
  return row.f.map((cell, i) => fieldFromJson(cell.v, schema[i]))
}

// ─── To JSON converters ──────────────────────────────────────────────────────

export function intToJson(value: unknown): string | unknown {
  if (typeof value === "number" || typeof value === "bigint") return String(value)
  return value
}

export function floatToJson(value: unknown): number | string | null {
  if (value == null) return null
  const n = Number(value)
  if (isNaN(n) || !isFinite(n)) return String(n)
  return n
}

export function decimalToJson(value: unknown): string | unknown {
  if (typeof value === "number" || typeof value === "string") return String(value)
  return value
}

export function boolToJson(value: unknown): string | unknown {
  if (typeof value === "boolean") return value ? "true" : "false"
  return value
}

export function bytesToJson(value: unknown): string | unknown {
  if (Buffer.isBuffer(value)) return value.toString("base64")
  return value
}

export function timestampToJsonRow(value: unknown): string | unknown {
  if (value instanceof Date) {
    return value.toISOString()
  }
  return value
}

export function dateToJson(value: unknown): string | unknown {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }
  return value
}

const SCALAR_VALUE_TO_JSON_ROW: Record<string, (v: unknown) => unknown> = {
  INT8: intToJson,
  INT16: intToJson,
  INT32: intToJson,
  INT64: intToJson,
  FLOAT32: floatToJson,
  FLOAT64: floatToJson,
  DECIMAL: decimalToJson,
  BOOL: boolToJson,
  BINARY: bytesToJson,
  TIMESTAMP: timestampToJsonRow,
  DATE: dateToJson,
}

export function scalarFieldToJson(field: SchemaField, rowValue: unknown): unknown {
  const converter = SCALAR_VALUE_TO_JSON_ROW[field.fieldType]
  if (!converter) return rowValue
  return converter(rowValue)
}

export function recordFieldToJson(fields: SchemaField[], rowValue: unknown): Record<string, unknown> {
  const record: Record<string, unknown> = {}
  const isDict = !Array.isArray(rowValue) && typeof rowValue === "object" && rowValue !== null

  for (let i = 0; i < fields.length; i++) {
    const subfield = fields[i]
    const subvalue = isDict
      ? (rowValue as Record<string, unknown>)[subfield.name]
      : (rowValue as unknown[])[i]
    if (subvalue != null) {
      record[subfield.name] = fieldToJson(subfield, subvalue)
    }
  }
  return record
}

export function singleFieldToJson(field: SchemaField, rowValue: unknown): unknown {
  if (rowValue == null) return null
  if (field.fieldType === "RECORD") return recordFieldToJson(field.fields, rowValue)
  return scalarFieldToJson(field, rowValue)
}

export function fieldToJson(field: SchemaField, rowValue: unknown): unknown {
  if (rowValue == null) return null
  if (field.mode === "REPEATED") {
    return (rowValue as unknown[]).map(item => singleFieldToJson(field, item))
  }
  return singleFieldToJson(field, rowValue)
}

// ─── Utility helpers ─────────────────────────────────────────────────────────

export function snakeToCamelCase(value: string): string {
  const words = value.split("_")
  return words[0] + words.slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("")
}

export function getSubProp(container: Record<string, unknown>, keys: string | string[], defaultValue?: unknown): unknown {
  const keyArr = typeof keys === "string" ? [keys] : keys
  let sub: unknown = container
  for (const key of keyArr) {
    if (sub == null || typeof sub !== "object" || !(key in (sub as Record<string, unknown>))) return defaultValue
    sub = (sub as Record<string, unknown>)[key]
  }
  return sub
}

export function setSubProp(container: Record<string, unknown>, keys: string | string[], value: unknown): void {
  const keyArr = typeof keys === "string" ? [keys] : keys
  let sub = container
  for (let i = 0; i < keyArr.length - 1; i++) {
    if (!(keyArr[i] in sub)) sub[keyArr[i]] = {}
    sub = sub[keyArr[i]] as Record<string, unknown>
  }
  sub[keyArr[keyArr.length - 1]] = value
}

export function delSubProp(container: Record<string, unknown>, keys: string[]): void {
  let sub = container
  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in sub)) return
    sub = sub[keys[i]] as Record<string, unknown>
  }
  delete sub[keys[keys.length - 1]]
}

export function intOrNone(value: unknown): number | undefined {
  if (typeof value === "number") return value
  if (value != null) return Number(value)
  return undefined
}

export function strOrNone(value: unknown): string | undefined {
  if (value != null) return String(value)
  return undefined
}

export function fieldToIndexMapping(schema: SchemaField[]): Record<string, number> {
  const mapping: Record<string, number> = {}
  for (let i = 0; i < schema.length; i++) {
    mapping[schema[i].name] = i
  }
  return mapping
}

// ─── Additional helpers from Python _helpers.py ──────────────────────────────

export function dateFromIso8601Date(value: string): Date {
  return new Date(value + "T00:00:00Z")
}

export function datetimeFromMicroseconds(value: number): Date {
  const EPOCH_MS = 0
  return new Date(EPOCH_MS + value / 1000)
}

export function toBytes(value: string | Buffer): Buffer {
  if (typeof value === "string") return Buffer.from(value, "ascii")
  if (Buffer.isBuffer(value)) return value
  throw new TypeError(`${value} could not be converted to bytes`)
}

export function timestampToJsonParameter(value: unknown): string | unknown {
  if (value instanceof Date) {
    const utc = new Date(value.getTime() - (value.getTimezoneOffset() * 60000))
    return utc.toISOString().replace("T", " ").replace("Z", "+00:00")
  }
  return value
}

export function datetimeToJson(value: unknown): string | unknown {
  if (value instanceof Date) {
    return value.toISOString().replace("Z", "").slice(0, 26)
  }
  return value
}

export function timeToJson(value: unknown): string | unknown {
  if (typeof value === "string") return value
  return value
}

export function repeatedFieldToJson(field: SchemaField, rowValue: unknown): unknown[] {
  if (!Array.isArray(rowValue)) return []
  return rowValue.map(item => singleFieldToJson(field, item))
}

export function splitId(fullId: string): string[] {
  return fullId.split(".")
}

export function buildResourceFromProperties(
  properties: Record<string, unknown>,
  propertyToApiField: Record<string, string>,
  filterFields: string[],
): Record<string, unknown> {
  const partial: Record<string, unknown> = {}
  for (const filterField of filterFields) {
    const apiField = propertyToApiField[filterField]
    if (apiField) {
      partial[apiField] = properties[apiField]
    } else {
      partial[filterField] = properties[filterField]
    }
  }
  return partial
}

export function verifyJobConfigType(jobConfig: unknown, expectedType: new (...args: unknown[]) => unknown, paramName = "jobConfig"): void {
  if (!(jobConfig instanceof expectedType)) {
    throw new TypeError(
      `Expected an instance of ${expectedType.name} class for the ${paramName} parameter, but received ${paramName} = ${jobConfig}`,
    )
  }
}
