/**
 * ArgumentNormalizer — port of cz-mcp-server/cz_mcp/transport/argument_normalizer.py
 *
 * Python → TS mapping:
 *   argument_normalizer.py:20-35   ArgumentNormalizationError class
 *   argument_normalizer.py:37-529  ArgumentNormalizer class
 *   argument_normalizer.py:48-70   constructor (__init__)
 *   argument_normalizer.py:72-100  normalize()
 *   argument_normalizer.py:102-112 _apply_defaults()
 *   argument_normalizer.py:114-124 _validate_required_fields()
 *   argument_normalizer.py:126-179 _convert_types()
 *   argument_normalizer.py:181-233 convert_value() [static]
 *   argument_normalizer.py:234-248 _types_match() [static]
 *   argument_normalizer.py:250-265 _to_int() [static]
 *   argument_normalizer.py:267-277 _to_number() [static]
 *   argument_normalizer.py:279-285 _to_string() [static]
 *   argument_normalizer.py:287-301 _to_boolean() [static]
 *   argument_normalizer.py:303-322 _to_array() [static]
 *   argument_normalizer.py:324-349 _convert_array_items() [static]
 *   argument_normalizer.py:351-369 _to_object() [static]
 *   argument_normalizer.py:371-394 _convert_object_properties() [static]
 *   argument_normalizer.py:396-429 _validate_constraints()
 *   argument_normalizer.py:431-455 _build_missing_fields_error()
 *   argument_normalizer.py:457-497 _build_type_conversion_error()
 *   argument_normalizer.py:499-528 _build_enum_error()
 *   argument_normalizer.py:531-553 create_normalizer_for_tool()
 *
 * Divergence from Python:
 *   - Python uses inspect.signature to extract handler parameter types at runtime.
 *     TS cannot reflect function signatures at runtime, so type conversion is driven
 *     entirely by input_schema's `type` field (same data, different source).
 *   - handler_params is always treated as non-empty (schema-driven), so the
 *     `if not self.handler_params: return arguments` guard in _convert_types is
 *     replaced by checking whether properties exist in the schema.
 */

import { logger } from "../logger.js"
import type { ToolDefinition } from "../tool-registry.js"

// argument_normalizer.py:20-35
export class ArgumentNormalizationError extends Error {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details: Record<string, any>

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(message: string, details: Record<string, any> = {}) {
    super(message)
    this.name = "ArgumentNormalizationError"
    this.details = details
  }

  // argument_normalizer.py:28-34
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toResponseDict(): Record<string, any> {
    return {
      error: this.message,
      error_type: "ArgumentNormalizationError",
      details: this.details,
    }
  }
}

// argument_normalizer.py:37-529
export class ArgumentNormalizer {
  toolName: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (...args: any[]) => any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  samples: Array<Record<string, any>>

  // argument_normalizer.py:48-70
  constructor(
    toolName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (...args: any[]) => any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inputSchema: Record<string, any>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    samples: Array<Record<string, any>> = [],
  ) {
    this.toolName = toolName
    this.handler = handler
    this.inputSchema = inputSchema
    this.samples = samples
    // Note: Python extracts inspect.signature here; TS uses inputSchema.properties instead.
  }

  // argument_normalizer.py:72-100
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  normalize(arguments_: Record<string, any> | null | undefined): Record<string, any> {
    const args = arguments_ ?? {}

    // Step 1: Apply defaults from inputSchema
    let normalized = this._apply_defaults({ ...args })

    // Step 2: Validate required fields
    this._validate_required_fields(normalized)

    // Step 3: Type conversion based on inputSchema (replaces handler signature in Python)
    normalized = this._convert_types(normalized)

    // Step 4: Validate against inputSchema constraints
    this._validate_constraints(normalized)

    return normalized
  }

  // argument_normalizer.py:102-112
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _apply_defaults(arguments_: Record<string, any>): Record<string, any> {
    const properties = this.inputSchema["properties"] ?? {}

    for (const [paramName, paramSchema] of Object.entries(properties) as [string, Record<string, unknown>][]) {
      if (!(paramName in arguments_) && "default" in paramSchema) {
        const defaultValue = paramSchema["default"]
        arguments_[paramName] = defaultValue
        logger.debug({ param: paramName, default: defaultValue }, "Applied default value")
      }
    }

    return arguments_
  }

  // argument_normalizer.py:114-124
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _validate_required_fields(arguments_: Record<string, any>): void {
    const requiredFields: string[] = this.inputSchema["required"] ?? []
    const missingFields = requiredFields.filter((f) => !(f in arguments_))

    if (missingFields.length > 0) {
      const errorMsg = this._build_missing_fields_error(missingFields)
      throw new ArgumentNormalizationError(errorMsg, {
        missing_fields: missingFields,
        provided_fields: Object.keys(arguments_),
      })
    }
  }

  // argument_normalizer.py:126-179
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _convert_types(arguments_: Record<string, any>): Record<string, any> {
    // Python: if not self.handler_params: return arguments
    // TS: use schema properties as the type source
    const properties = this.inputSchema["properties"] ?? {}
    if (Object.keys(properties).length === 0) {
      return arguments_
    }

    const converted = { ...arguments_ }

    for (const [paramName, paramValue] of Object.entries(arguments_)) {
      // Skip parameters not in schema
      if (!(paramName in properties)) continue

      const paramSchema = properties[paramName] as Record<string, unknown>
      const expectedType = paramSchema["type"] as string | undefined

      try {
        if (expectedType === "array" || expectedType === "object") {
          // Always convert complex types to handle nested conversions
          converted[paramName] = ArgumentNormalizer.convert_value(
            paramName,
            paramValue,
            expectedType,
            paramSchema,
          )
        } else {
          // For simple types, only convert if needed
          if (!ArgumentNormalizer._types_match(paramValue, expectedType)) {
            converted[paramName] = ArgumentNormalizer.convert_value(
              paramName,
              paramValue,
              expectedType,
              paramSchema,
            )
          }
        }
      } catch (e) {
        const errorMsg = this._build_type_conversion_error(
          paramName,
          paramValue,
          expectedType,
          paramSchema,
          e as Error,
        )
        throw new ArgumentNormalizationError(errorMsg, {
          parameter: paramName,
          provided_value: String(paramValue),
          provided_type: typeof paramValue,
          expected_type: expectedType,
          conversion_error: String(e),
        })
      }
    }

    return converted
  }

  // argument_normalizer.py:181-233
  static convert_value(
    paramName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any,
    expectedType: string | undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): any {
    // If value is None/null and type allows null, return null
    if (value === null || value === undefined) {
      return null
    }

    // For complex types (array, object), always process to handle nested conversions
    if (expectedType !== "array" && expectedType !== "object") {
      // Check if types already match for simple types
      if (ArgumentNormalizer._types_match(value, expectedType)) {
        return value
      }
    }

    // Perform type conversion
    if (expectedType === "integer") {
      return ArgumentNormalizer._to_int(paramName, value)
    } else if (expectedType === "number") {
      return ArgumentNormalizer._to_number(paramName, value)
    } else if (expectedType === "string") {
      return ArgumentNormalizer._to_string(paramName, value)
    } else if (expectedType === "boolean") {
      return ArgumentNormalizer._to_boolean(paramName, value)
    } else if (expectedType === "array") {
      return ArgumentNormalizer._to_array(paramName, value, schema)
    } else if (expectedType === "object") {
      return ArgumentNormalizer._to_object(paramName, value, schema)
    } else {
      // Unknown type, return as is
      logger.warn({ expectedType, paramName }, "Unknown type for parameter")
      return value
    }
  }

  // argument_normalizer.py:234-248
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static _types_match(value: any, expectedType: string | undefined): boolean {
    if (expectedType === undefined) return true

    if (expectedType === "integer") return Number.isInteger(value)
    if (expectedType === "number") return typeof value === "number"
    if (expectedType === "string") return typeof value === "string"
    if (expectedType === "boolean") return typeof value === "boolean"
    if (expectedType === "array") return Array.isArray(value)
    if (expectedType === "object") return typeof value === "object" && !Array.isArray(value) && value !== null

    return false
  }

  // argument_normalizer.py:250-265
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static _to_int(_paramName: string, value: any): number {
    if (typeof value === "number" && Number.isInteger(value)) return value
    if (typeof value === "number") return Math.trunc(value)
    if (typeof value === "string") {
      const asInt = parseInt(value, 10)
      if (!isNaN(asInt)) return asInt
      const asFloat = parseFloat(value)
      if (!isNaN(asFloat)) return Math.trunc(asFloat)
      throw new Error(`Cannot convert '${value}' to integer`)
    }
    throw new Error(`Cannot convert ${typeof value} to integer`)
  }

  // argument_normalizer.py:267-277
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static _to_number(_paramName: string, value: any): number {
    if (typeof value === "number") return value
    if (typeof value === "string") {
      const n = parseFloat(value)
      if (!isNaN(n)) return n
      throw new Error(`Cannot convert '${value}' to number`)
    }
    throw new Error(`Cannot convert ${typeof value} to number`)
  }

  // argument_normalizer.py:279-285
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static _to_string(_paramName: string, value: any): string {
    if (typeof value === "string") return value
    // Convert other types to string representation
    return String(value)
  }

  // argument_normalizer.py:287-301
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static _to_boolean(_paramName: string, value: any): boolean {
    if (typeof value === "boolean") return value
    if (typeof value === "string") {
      const lower = value.toLowerCase()
      if (["true", "yes", "1", "on"].includes(lower)) return true
      if (["false", "no", "0", "off"].includes(lower)) return false
      throw new Error(`Cannot convert string '${value}' to boolean`)
    }
    if (typeof value === "number") return Boolean(value)
    throw new Error(`Cannot convert ${typeof value} to boolean`)
  }

  // argument_normalizer.py:303-322
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static _to_array(_paramName: string, value: any, schema: Record<string, any>): any[] {
    if (Array.isArray(value)) {
      return ArgumentNormalizer._convert_array_items(value, schema)
    }

    if (typeof value === "string") {
      let parsed: unknown
      try {
        parsed = JSON.parse(value)
      } catch (e) {
        throw new Error(`Cannot parse string as JSON array: ${e}`)
      }
      if (Array.isArray(parsed)) {
        return ArgumentNormalizer._convert_array_items(parsed, schema)
      } else {
        throw new Error(`Parsed JSON is not an array: ${typeof parsed}`)
      }
    }

    throw new Error(`Cannot convert ${typeof value} to array`)
  }

  // argument_normalizer.py:324-349
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static _convert_array_items(array: any[], schema: Record<string, any>): any[] {
    const itemsSchema = (schema["items"] ?? {}) as Record<string, unknown>
    const itemType = itemsSchema["type"] as string | undefined

    if (!itemType) {
      // No item type specified, return as is
      return array
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const convertedItems: any[] = []
    for (let i = 0; i < array.length; i++) {
      const item = array[i]
      if (!ArgumentNormalizer._types_match(item, itemType)) {
        try {
          const convertedItem = ArgumentNormalizer.convert_value(
            `item[${i}]`,
            item,
            itemType,
            itemsSchema as Record<string, unknown>,
          )
          convertedItems.push(convertedItem)
        } catch (e) {
          logger.warn(
            { index: i, fromType: typeof item, toType: itemType, err: String(e) },
            "Failed to convert array item",
          )
          convertedItems.push(item)
        }
      } else {
        convertedItems.push(item)
      }
    }

    return convertedItems
  }

  // argument_normalizer.py:351-369
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static _to_object(_paramName: string, value: any, schema: Record<string, any>): Record<string, any> {
    if (typeof value === "object" && !Array.isArray(value) && value !== null) {
      return ArgumentNormalizer._convert_object_properties(value, schema)
    }

    if (typeof value === "string") {
      let parsed: unknown
      try {
        parsed = JSON.parse(value)
      } catch (e) {
        throw new Error(`Cannot parse string as JSON object: ${e}`)
      }
      if (typeof parsed === "object" && !Array.isArray(parsed) && parsed !== null) {
        return ArgumentNormalizer._convert_object_properties(parsed as Record<string, unknown>, schema)
      } else {
        throw new Error(`Parsed JSON is not an object: ${typeof parsed}`)
      }
    }

    throw new Error(`Cannot convert ${typeof value} to object`)
  }

  // argument_normalizer.py:371-394
  static _convert_object_properties(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    obj: Record<string, any>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Record<string, any> {
    const propertiesSchema = (schema["properties"] ?? {}) as Record<string, Record<string, unknown>>

    if (Object.keys(propertiesSchema).length === 0) {
      // No properties schema, return as is
      return obj
    }

    const convertedObj = { ...obj }

    for (const [propName, propValue] of Object.entries(obj)) {
      if (propName in propertiesSchema) {
        const propSchema = propertiesSchema[propName]!
        const propType = propSchema["type"] as string | undefined

        try {
          convertedObj[propName] = ArgumentNormalizer.convert_value(
            propName,
            propValue,
            propType,
            propSchema,
          )
        } catch (e) {
          logger.warn({ prop: propName, err: String(e) }, "Failed to convert object property")
        }
      }
    }

    return convertedObj
  }

  // argument_normalizer.py:396-429
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _validate_constraints(arguments_: Record<string, any>): void {
    const properties = this.inputSchema["properties"] ?? {}

    for (const [paramName, paramValue] of Object.entries(arguments_)) {
      if (!(paramName in properties)) continue

      const paramSchema = properties[paramName] as Record<string, unknown>

      // Validate enum
      if ("enum" in paramSchema) {
        const enumValues = paramSchema["enum"] as unknown[]
        if (!enumValues.includes(paramValue)) {
          const errorMsg = this._build_enum_error(paramName, paramValue, enumValues, paramSchema)
          throw new ArgumentNormalizationError(errorMsg, {
            parameter: paramName,
            provided_value: paramValue,
            allowed_values: enumValues,
          })
        }
      }

      // Validate numeric constraints
      const paramType = paramSchema["type"] as string | undefined
      if (paramType === "integer" || paramType === "number") {
        if ("minimum" in paramSchema && (paramValue as number) < (paramSchema["minimum"] as number)) {
          throw new ArgumentNormalizationError(
            `Parameter '${paramName}' value ${paramValue} is below minimum ${paramSchema["minimum"]}`,
            { parameter: paramName, value: paramValue, minimum: paramSchema["minimum"] },
          )
        }

        if ("maximum" in paramSchema && (paramValue as number) > (paramSchema["maximum"] as number)) {
          throw new ArgumentNormalizationError(
            `Parameter '${paramName}' value ${paramValue} exceeds maximum ${paramSchema["maximum"]}`,
            { parameter: paramName, value: paramValue, maximum: paramSchema["maximum"] },
          )
        }
      }
    }
  }

  // argument_normalizer.py:431-455
  private _build_missing_fields_error(missingFields: string[]): string {
    const properties = this.inputSchema["properties"] ?? {}

    const errorParts: string[] = [
      `❌ Missing required parameters for tool '${this.toolName}':`,
      "",
    ]

    for (const field of missingFields) {
      const fieldSchema = (properties[field] ?? {}) as Record<string, unknown>
      const fieldDesc = (fieldSchema["description"] as string | undefined) ?? "No description available"
      const fieldType = (fieldSchema["type"] as string | undefined) ?? "unknown"
      errorParts.push(`  • ${field} (${fieldType}): ${fieldDesc}`)
    }

    // Add example if available
    if (this.samples.length > 0) {
      errorParts.push("")
      errorParts.push("💡 Example usage:")
      const sample = this.samples[0]!
      if ("query" in sample) {
        errorParts.push(`   ${JSON.stringify(sample["query"], null, 2)}`)
      }
    }

    return errorParts.join("\n")
  }

  // argument_normalizer.py:457-497
  private _build_type_conversion_error(
    paramName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any,
    expectedType: string | undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: Record<string, any>,
    originalError: Error,
  ): string {
    const errorParts: string[] = [
      `❌ Type conversion failed for parameter '${paramName}' in tool '${this.toolName}':`,
      "",
      `  Provided value: ${value}`,
      `  Provided type: ${typeof value}`,
      `  Expected type: ${expectedType}`,
      "",
    ]

    // Add description
    if ("description" in schema) {
      errorParts.push(`  Description: ${schema["description"]}`)
      errorParts.push("")
    }

    // Add enum values if applicable
    if ("enum" in schema) {
      const enumVals = (schema["enum"] as unknown[]).map(String).join(", ")
      errorParts.push(`  Allowed values: ${enumVals}`)
      errorParts.push("")
    }

    // Add conversion hint
    errorParts.push(`  Conversion error: ${String(originalError)}`)

    // Add example if available
    if (this.samples.length > 0) {
      errorParts.push("")
      errorParts.push("💡 Example:")
      const sample = this.samples[0]!
      if ("query" in sample && paramName in (sample["query"] as Record<string, unknown>)) {
        const exampleValue = (sample["query"] as Record<string, unknown>)[paramName]
        errorParts.push(`   ${paramName}: ${JSON.stringify(exampleValue)}`)
      }
    }

    return errorParts.join("\n")
  }

  // argument_normalizer.py:499-528
  private _build_enum_error(
    paramName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any,
    enumValues: unknown[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: Record<string, any>,
  ): string {
    const errorParts: string[] = [
      `❌ Invalid value for parameter '${paramName}' in tool '${this.toolName}':`,
      "",
      `  Provided: ${value}`,
      `  Allowed values: ${enumValues.map(String).join(", ")}`,
      "",
    ]

    // Add description
    if ("description" in schema) {
      errorParts.push(`  Description: ${schema["description"]}`)
      errorParts.push("")
    }

    // Add example if available
    if (this.samples.length > 0) {
      errorParts.push("💡 Example:")
      const sample = this.samples[0]!
      if ("query" in sample && paramName in (sample["query"] as Record<string, unknown>)) {
        const exampleValue = (sample["query"] as Record<string, unknown>)[paramName]
        errorParts.push(`   ${paramName}: ${JSON.stringify(exampleValue)}`)
      }
    }

    return errorParts.join("\n")
  }
}

// argument_normalizer.py:531-553
export function create_normalizer_for_tool(tool: ToolDefinition): ArgumentNormalizer | null {
  // Check if tool has 'normalize' tag
  if (!tool.tags.includes("normalize")) {
    return null
  }

  const samples = tool.samples ?? []

  return new ArgumentNormalizer(
    tool.name,
    tool.handler,
    tool.inputSchema,
    samples,
  )
}
