/**
 * SQL type hierarchy ported from clickzetta/connector/v0/sql_types.py.
 * Provides SqlType base, all primitive/nested types, visitor pattern, and protoToSqlType.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

export enum TimestampUnit {
  SECONDS = 0,
  MILLISECONDS = 3,
  MICROSECONDS = 6,
  NANOSECONDS = 9,
}

export enum IntervalUnit {
  YEAR = 1,
  MONTH = 2,
  DAY = 3,
  HOUR = 4,
  MINUTE = 5,
  SECOND = 6,
}

export enum VectorNumberType {
  TINYINT = "I8",
  INT = "I32",
  FLOAT16 = "F16",
  FLOAT = "F32",
}

// ─── Base Types ──────────────────────────────────────────────────────────────

export abstract class SqlType {
  readonly nullable: boolean
  abstract readonly category: string
  protected abstract readonly shortName: string

  constructor(nullable = true) {
    this.nullable = nullable
  }

  accept<T>(visitor: SqlTypeVisitor<T>): T {
    const method = `visit${this.shortName.charAt(0).toUpperCase()}${this.shortName.slice(1)}` as keyof SqlTypeVisitor<T>
    return (visitor[method] as (t: SqlType) => T)(this)
  }

  protected get notNullStr(): string {
    return this.nullable ? "" : " not null"
  }

  equals(other: unknown): boolean {
    return other instanceof SqlType && other.constructor === this.constructor && this.nullable === other.nullable
  }
}

export abstract class PrimitiveType extends SqlType {
  override toString(): string {
    return `${this.shortName}${this.notNullStr}`
  }
}

// ─── Void ────────────────────────────────────────────────────────────────────

export class VoidType extends PrimitiveType {
  readonly category = "VOID"
  protected readonly shortName = "void"
  constructor() {
    super(true)
  }
}

// ─── Numeric Types ───────────────────────────────────────────────────────────

export abstract class NumericType extends PrimitiveType {}
export abstract class IntegralType extends NumericType {}

export class TinyintType extends IntegralType {
  readonly category = "INT8"
  protected readonly shortName = "tinyint"
  constructor(nullable = true) { super(nullable) }
}

export class SmallintType extends IntegralType {
  readonly category = "INT16"
  protected readonly shortName = "smallint"
  constructor(nullable = true) { super(nullable) }
}

export class IntType extends IntegralType {
  readonly category = "INT32"
  protected readonly shortName = "int"
  constructor(nullable = true) { super(nullable) }
}

export class BigintType extends IntegralType {
  readonly category = "INT64"
  protected readonly shortName = "bigint"
  constructor(nullable = true) { super(nullable) }
}

export abstract class FloatingType extends NumericType {}

export class FloatType extends FloatingType {
  readonly category = "FLOAT32"
  protected readonly shortName = "float"
  constructor(nullable = true) { super(nullable) }
}

export class DoubleType extends FloatingType {
  readonly category = "FLOAT64"
  protected readonly shortName = "double"
  constructor(nullable = true) { super(nullable) }
}

export class DecimalType extends NumericType {
  readonly category = "DECIMAL"
  protected readonly shortName = "decimal"
  readonly precision: number
  readonly scale: number

  constructor(precision: number, scale: number, nullable = true) {
    super(nullable)
    this.precision = precision
    this.scale = scale
  }

  override toString(): string {
    return `decimal(${this.precision},${this.scale})${this.notNullStr}`
  }

  override equals(other: unknown): boolean {
    return other instanceof DecimalType && this.nullable === other.nullable &&
      this.precision === other.precision && this.scale === other.scale
  }
}

// ─── Boolean ─────────────────────────────────────────────────────────────────

export class BooleanType extends PrimitiveType {
  readonly category = "BOOL"
  protected readonly shortName = "boolean"
  constructor(nullable = true) { super(nullable) }
}

// ─── Text Types ──────────────────────────────────────────────────────────────

export abstract class TextType extends PrimitiveType {}

export abstract class BaseCharType extends TextType {
  readonly length: number
  constructor(length: number, nullable = true) {
    super(nullable)
    this.length = length
  }
  override toString(): string {
    return `${this.shortName}(${this.length})${this.notNullStr}`
  }
  override equals(other: unknown): boolean {
    return other instanceof BaseCharType && other.constructor === this.constructor &&
      this.nullable === other.nullable && this.length === other.length
  }
}

export class CharType extends BaseCharType {
  readonly category = "CHAR"
  protected readonly shortName = "char"
}

export class VarcharType extends BaseCharType {
  readonly category = "VARCHAR"
  protected readonly shortName = "varchar"
}

export class StringType extends TextType {
  readonly category = "STRING"
  protected readonly shortName = "string"
  constructor(nullable = true) { super(nullable) }
}

// ─── Binary ──────────────────────────────────────────────────────────────────

export class BinaryType extends PrimitiveType {
  readonly category = "BINARY"
  protected readonly shortName = "binary"
  constructor(nullable = true) { super(nullable) }
}

// ─── Date ────────────────────────────────────────────────────────────────────

export class DateType extends PrimitiveType {
  readonly category = "DATE"
  protected readonly shortName = "date"
  constructor(nullable = true) { super(nullable) }
}

// ─── Timestamp Types ─────────────────────────────────────────────────────────

export abstract class TimestampType extends PrimitiveType {
  readonly unit: TimestampUnit
  constructor(unit: TimestampUnit, nullable = true) {
    super(nullable)
    this.unit = unit
  }
  override equals(other: unknown): boolean {
    return other instanceof TimestampType && other.constructor === this.constructor &&
      this.nullable === other.nullable && this.unit === other.unit
  }
}

export class TimestampLtzType extends TimestampType {
  readonly category = "TIMESTAMP_LTZ"
  protected readonly shortName = "timestampLtz"
}

export class TimestampNtzType extends TimestampType {
  readonly category = "TIMESTAMP_NTZ"
  protected readonly shortName = "timestampNtz"
}

// ─── Interval Types ──────────────────────────────────────────────────────────

export abstract class IntervalType extends PrimitiveType {}

export class IntervalYearMonthType extends IntervalType {
  readonly category = "INTERVAL_YEAR_MONTH"
  protected readonly shortName = "intervalYearMonth"
  readonly from: IntervalUnit
  readonly to: IntervalUnit

  private static NAME_MAPPING: Record<string, string> = {
    [`${IntervalUnit.YEAR},${IntervalUnit.YEAR}`]: "year",
    [`${IntervalUnit.YEAR},${IntervalUnit.MONTH}`]: "year to month",
    [`${IntervalUnit.MONTH},${IntervalUnit.MONTH}`]: "month",
  }

  constructor(from: IntervalUnit, to: IntervalUnit, nullable = true) {
    super(nullable)
    this.from = from
    this.to = to
  }

  override toString(): string {
    const name = IntervalYearMonthType.NAME_MAPPING[`${this.from},${this.to}`]
    if (name) return `interval ${name}${this.notNullStr}`
    throw new TypeError(`Invalid IntervalYearMonthType (${this.from}, ${this.to})`)
  }

  override equals(other: unknown): boolean {
    return other instanceof IntervalYearMonthType && this.nullable === other.nullable &&
      this.from === other.from && this.to === other.to
  }
}

export class IntervalDayTimeType extends IntervalType {
  readonly category = "INTERVAL_DAY_TIME"
  protected readonly shortName = "intervalDayTime"
  readonly from: IntervalUnit
  readonly to: IntervalUnit
  readonly precision: TimestampUnit

  private static NAME_MAPPING: Record<string, string> = {
    [`${IntervalUnit.DAY},${IntervalUnit.DAY}`]: "day",
    [`${IntervalUnit.HOUR},${IntervalUnit.HOUR}`]: "hour",
    [`${IntervalUnit.MINUTE},${IntervalUnit.MINUTE}`]: "minute",
    [`${IntervalUnit.SECOND},${IntervalUnit.SECOND}`]: "second",
    [`${IntervalUnit.DAY},${IntervalUnit.HOUR}`]: "day to hour",
    [`${IntervalUnit.DAY},${IntervalUnit.MINUTE}`]: "day to minute",
    [`${IntervalUnit.DAY},${IntervalUnit.SECOND}`]: "day to second",
    [`${IntervalUnit.HOUR},${IntervalUnit.MINUTE}`]: "hour to minute",
    [`${IntervalUnit.HOUR},${IntervalUnit.SECOND}`]: "hour to second",
    [`${IntervalUnit.MINUTE},${IntervalUnit.SECOND}`]: "minute to second",
  }

  constructor(from: IntervalUnit, to: IntervalUnit, precision: TimestampUnit, nullable = true) {
    super(nullable)
    this.from = from
    this.to = to
    this.precision = precision
  }

  override toString(): string {
    const name = IntervalDayTimeType.NAME_MAPPING[`${this.from},${this.to}`]
    if (name) return `interval ${name}${this.notNullStr}`
    throw new TypeError(`Invalid IntervalDayTimeType (${this.from}, ${this.to})`)
  }

  override equals(other: unknown): boolean {
    return other instanceof IntervalDayTimeType && this.nullable === other.nullable &&
      this.from === other.from && this.to === other.to && this.precision === other.precision
  }
}

// ─── Bitmap ──────────────────────────────────────────────────────────────────

export class BitmapType extends PrimitiveType {
  readonly category = "BITMAP"
  protected readonly shortName = "bitmap"
  constructor(nullable = true) { super(nullable) }
}

// ─── JSON ────────────────────────────────────────────────────────────────────

export class JsonType extends PrimitiveType {
  readonly category = "JSON"
  protected readonly shortName = "json"
  constructor(nullable = true) { super(nullable) }
}

// ─── Vector ──────────────────────────────────────────────────────────────────

export class VectorType extends PrimitiveType {
  readonly category = "VECTOR_TYPE"
  protected readonly shortName = "vector"
  readonly numberType: VectorNumberType
  readonly dimension: number

  constructor(numberType: VectorNumberType, dimension: number, nullable = true) {
    super(nullable)
    this.numberType = numberType
    this.dimension = dimension
  }

  override toString(): string {
    const name = Object.entries(VectorNumberType).find(([, v]) => v === this.numberType)?.[0]?.toLowerCase() ?? "unknown"
    return `vector(${name},${this.dimension})${this.notNullStr}`
  }

  override equals(other: unknown): boolean {
    return other instanceof VectorType && this.nullable === other.nullable &&
      this.numberType === other.numberType && this.dimension === other.dimension
  }
}

// ─── Nested Types ────────────────────────────────────────────────────────────

export abstract class NestedType extends SqlType {}

export class ArrayType extends NestedType {
  readonly category = "ARRAY"
  protected readonly shortName = "array"
  readonly elementType: SqlType

  constructor(elementType: SqlType, nullable = true) {
    super(nullable)
    this.elementType = elementType
  }

  override toString(): string {
    return `array<${this.elementType}>${this.notNullStr}`
  }

  override equals(other: unknown): boolean {
    return other instanceof ArrayType && this.nullable === other.nullable &&
      this.elementType.equals(other.elementType)
  }
}

export class MapType extends NestedType {
  readonly category = "MAP"
  protected readonly shortName = "map"
  readonly keyType: SqlType
  readonly valueType: SqlType

  constructor(keyType: SqlType, valueType: SqlType, nullable = true) {
    super(nullable)
    this.keyType = keyType
    this.valueType = valueType
  }

  override toString(): string {
    return `map<${this.keyType},${this.valueType}>${this.notNullStr}`
  }

  override equals(other: unknown): boolean {
    return other instanceof MapType && this.nullable === other.nullable &&
      this.keyType.equals(other.keyType) && this.valueType.equals(other.valueType)
  }
}

export interface StructField {
  name: string
  type: SqlType
}

export class StructType extends NestedType {
  readonly category = "STRUCT"
  protected readonly shortName = "struct"
  readonly fields: StructField[]

  constructor(fields: StructField[], nullable = true) {
    super(nullable)
    this.fields = fields
  }

  override toString(): string {
    const inner = this.fields.map(f => `${f.name}:${f.type}`).join(",")
    return `struct<${inner}>${this.notNullStr}`
  }

  override equals(other: unknown): boolean {
    if (!(other instanceof StructType)) return false
    if (this.nullable !== other.nullable || this.fields.length !== other.fields.length) return false
    return this.fields.every((f, i) =>
      f.name.toLowerCase() === other.fields[i].name.toLowerCase() && f.type.equals(other.fields[i].type)
    )
  }
}

// ─── Singletons ──────────────────────────────────────────────────────────────

export const VOID = new VoidType()
export const TINYINT = new TinyintType()
export const SMALLINT = new SmallintType()
export const INT = new IntType()
export const BIGINT = new BigintType()
export const FLOAT = new FloatType()
export const DOUBLE = new DoubleType()
export const BOOLEAN = new BooleanType()
export const STRING = new StringType()
export const BINARY = new BinaryType()
export const DATE = new DateType()
export const BITMAP = new BitmapType()
export const JSON_TYPE = new JsonType()

const NON_PARAMETERIZED: PrimitiveType[] = [
  VOID, TINYINT, SMALLINT, INT, BIGINT, FLOAT, DOUBLE, BOOLEAN, STRING, BINARY, DATE, BITMAP, JSON_TYPE,
]

const CATEGORY_TO_TYPE: Record<string, [SqlType, SqlType]> = {}
for (const t of NON_PARAMETERIZED) {
  const Ctor = t.constructor as new (nullable: boolean) => PrimitiveType
  CATEGORY_TO_TYPE[t.category] = [t, t instanceof VoidType ? VOID : new Ctor(false)]
}

// ─── Visitor ─────────────────────────────────────────────────────────────────

export interface SqlTypeVisitor<T = unknown> {
  visitAny?(t: SqlType): T
  visitPrimitive?(t: PrimitiveType): T
  visitVoid?(t: VoidType): T
  visitNumeric?(t: NumericType): T
  visitIntegral?(t: IntegralType): T
  visitTinyint?(t: TinyintType): T
  visitSmallint?(t: SmallintType): T
  visitInt?(t: IntType): T
  visitBigint?(t: BigintType): T
  visitFloating?(t: FloatingType): T
  visitFloat?(t: FloatType): T
  visitDouble?(t: DoubleType): T
  visitDecimal?(t: DecimalType): T
  visitBoolean?(t: BooleanType): T
  visitText?(t: TextType): T
  visitChar?(t: CharType): T
  visitVarchar?(t: VarcharType): T
  visitString?(t: StringType): T
  visitBinary?(t: BinaryType): T
  visitDate?(t: DateType): T
  visitTimestamp?(t: TimestampType): T
  visitTimestampLtz?(t: TimestampLtzType): T
  visitTimestampNtz?(t: TimestampNtzType): T
  visitInterval?(t: IntervalType): T
  visitIntervalYearMonth?(t: IntervalYearMonthType): T
  visitIntervalDayTime?(t: IntervalDayTimeType): T
  visitBitmap?(t: BitmapType): T
  visitNested?(t: NestedType): T
  visitArray?(t: ArrayType): T
  visitMap?(t: MapType): T
  visitStruct?(t: StructType): T
  visitJson?(t: JsonType): T
  visitVector?(t: VectorType): T
}

// ─── Proto Parsing ───────────────────────────────────────────────────────────

const TIMESTAMP_UNITS: Record<string, TimestampUnit> = Object.fromEntries(
  Object.entries(TimestampUnit).filter(([k]) => isNaN(Number(k))).map(([k, v]) => [k, v as TimestampUnit])
)

const INTERVAL_UNITS: Record<string, IntervalUnit> = Object.fromEntries(
  Object.entries(IntervalUnit).filter(([k]) => isNaN(Number(k))).map(([k, v]) => [k, v as IntervalUnit])
)

const VECTOR_NUMBER_TYPES: Record<string, VectorNumberType> = Object.fromEntries(
  Object.values(VectorNumberType).map(v => [v, v])
)

function parseTimestampUnit(v: string): TimestampUnit {
  const unit = TIMESTAMP_UNITS[v]
  if (unit !== undefined) return unit
  throw new Error(`Invalid timestamp unit: ${v}`)
}

function parseIntervalUnit(v: string): IntervalUnit {
  const unit = INTERVAL_UNITS[v]
  if (unit !== undefined) return unit
  throw new Error(`Invalid interval unit: ${v}`)
}

function parseVectorNumberType(v: string): VectorNumberType {
  const t = VECTOR_NUMBER_TYPES[v]
  if (t !== undefined) return t
  throw new Error(`Invalid vector number type: ${v}`)
}

/** Convert a protobuf-like type descriptor to a SqlType instance. */
export function protoToSqlType(proto: Record<string, unknown>): SqlType {
  const nullable = proto.nullable as boolean
  const category = proto.category as string

  // Non-parameterized types
  const pair = CATEGORY_TO_TYPE[category]
  if (pair) return nullable ? pair[0] : pair[1]

  // Parameterized types
  switch (category) {
    case "CHAR": {
      const info = proto.charTypeInfo as Record<string, unknown>
      return new CharType(Number(info.length), nullable)
    }
    case "VARCHAR": {
      const info = proto.varCharTypeInfo as Record<string, unknown>
      return new VarcharType(Number(info.length), nullable)
    }
    case "DECIMAL": {
      const info = proto.decimalTypeInfo as Record<string, unknown>
      return new DecimalType(Number(info.precision), Number(info.scale), nullable)
    }
    case "ARRAY": {
      const info = proto.arrayTypeInfo as Record<string, unknown>
      return new ArrayType(protoToSqlType(info.elementType as Record<string, unknown>), nullable)
    }
    case "MAP": {
      const info = proto.mapTypeInfo as Record<string, unknown>
      return new MapType(
        protoToSqlType(info.keyType as Record<string, unknown>),
        protoToSqlType(info.valueType as Record<string, unknown>),
        nullable,
      )
    }
    case "STRUCT": {
      const info = proto.structTypeInfo as Record<string, unknown>
      const fields = (info.fields as Record<string, unknown>[]).map(f => ({
        name: f.name as string,
        type: protoToSqlType(f.type as Record<string, unknown>),
      }))
      return new StructType(fields, nullable)
    }
    case "INTERVAL_DAY_TIME": {
      const info = proto.intervalDayTimeInfo as Record<string, unknown>
      return new IntervalDayTimeType(
        parseIntervalUnit(info.from as string),
        parseIntervalUnit(info.to as string),
        parseTimestampUnit(info.precision as string),
        nullable,
      )
    }
    case "INTERVAL_YEAR_MONTH": {
      const info = proto.intervalYearMonthInfo as Record<string, unknown>
      return new IntervalYearMonthType(
        parseIntervalUnit(info.from as string),
        parseIntervalUnit(info.to as string),
        nullable,
      )
    }
    case "TIMESTAMP_LTZ": {
      const info = proto.timestampInfo as Record<string, unknown>
      return new TimestampLtzType(parseTimestampUnit(info.tsUnit as string), nullable)
    }
    case "TIMESTAMP_NTZ": {
      const info = proto.timestampInfo as Record<string, unknown>
      return new TimestampNtzType(parseTimestampUnit(info.tsUnit as string), nullable)
    }
    case "VECTOR_TYPE": {
      const info = proto.vectorInfo as Record<string, unknown>
      return new VectorType(parseVectorNumberType(info.numberType as string), info.dimension as number, nullable)
    }
    case "VOID":
      return new VoidType()
    default:
      throw new Error(`Invalid category: ${category}`)
  }
}
