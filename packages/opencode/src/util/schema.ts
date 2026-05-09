import { Schema } from "effect"

/**
 * Attach static methods to a schema object. Designed to be used with `.pipe()`:
 *
 * @example
 *   export const Foo = fooSchema.pipe(
 *     withStatics((schema) => ({
 *       zero: schema.make(0),
 *       from: Schema.decodeUnknownOption(schema),
 *     }))
 *   )
 *
 * Properties are defined as lazy getters evaluated on first access.
 * This prevents circular-dependency crashes in bundled binaries where
 * module initialisation order differs from source — the factory is only
 * called when a property is first read, by which time all modules are
 * fully initialised.
 */
export const withStatics =
  <S extends object, M extends Record<string, unknown>>(methods: (schema: S) => M) =>
  (schema: S): S & M => {
    // Call methods() once to discover the property keys, then redefine each
    // key as a lazy getter so the actual value is re-evaluated on first access.
    // This handles the case where the factory captures module-level values that
    // are not yet initialised at the time withStatics runs (circular deps).
    const keys = Object.keys(methods(schema))
    let resolved: M | undefined
    for (const key of keys) {
      Object.defineProperty(schema, key, {
        get() {
          if (!resolved) resolved = methods(schema)
          return (resolved as Record<string, unknown>)[key]
        },
        configurable: true,
        enumerable: true,
      })
    }
    return schema as S & M
  }

declare const NewtypeBrand: unique symbol
type NewtypeBrand<Tag extends string> = { readonly [NewtypeBrand]: Tag }

/**
 * Nominal wrapper for scalar types. The class itself is a valid schema —
 * pass it directly to `Schema.decode`, `Schema.decodeEffect`, etc.
 *
 * @example
 *   class QuestionID extends Newtype<QuestionID>()("QuestionID", Schema.String) {
 *     static make(id: string): QuestionID {
 *       return this.make(id)
 *     }
 *   }
 *
 *   Schema.decodeEffect(QuestionID)(input)
 */
export function Newtype<Self>() {
  return <const Tag extends string, S extends Schema.Top>(tag: Tag, schema: S) => {
    type Branded = NewtypeBrand<Tag>

    abstract class Base {
      declare readonly [NewtypeBrand]: Tag

      static make(value: Schema.Schema.Type<S>): Self {
        return value as unknown as Self
      }
    }

    Object.setPrototypeOf(Base, schema)

    return Base as unknown as (abstract new (_: never) => Branded) & {
      readonly make: (value: Schema.Schema.Type<S>) => Self
    } & Omit<Schema.Opaque<Self, S, {}>, "make">
  }
}
