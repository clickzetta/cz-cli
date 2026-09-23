# Fact as Relationship Key

> Native deployment of this representation is blocked in the verified ClickZetta dialect. The following preserves the modeling intent and input shape; it is not a supported deployable recipe. Use the explicit alternative below and verify its business equivalence.

## How it works

When the join key you need does not exist as a physical column on the fact table, derive it as a **fact** (scalar expression on physical columns) and use that fact's logical name as the `left_column` in the relationship.

Example: `sales` has `sale_date` but no `fiscal_quarter_key`. Compute `fiscal_qtr_key = CONCAT(YEAR(sale_date), '-Q', QUARTER(sale_date))` as a fact, then reference it from the relationship. This is the intended computation; the current native compiler rejects its use as a relationship key.

Two pieces:

1. **Computed fact** — `expr: CONCAT(...)` — must be a scalar (row-level) expression, not an aggregation.
2. **Relationship referencing the fact's logical name** as `left_column` — the right side must point to a declared `primary_key` on the target.

## Snippet

```yaml-intent
name: fact_as_relationship_key_intent
tables:
  - name: fiscal_quarters
    base_table: { database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: FISCAL_QUARTERS }
    primary_key: { columns: [FISCAL_QUARTER_KEY] }
    dimensions:
      - { name: quarter_name, expr: QUARTER_NAME, data_type: VARCHAR }
      - { name: fiscal_year,  expr: FISCAL_YEAR,  data_type: NUMBER }
    metrics:
      - name: total_budget
        expr: SUM(BUDGET_AMOUNT)

  - name: sales
    base_table: { database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: SALES }
    primary_key: { columns: [SALE_ID] }
    facts:
      # Computed FK fact: derives the join key from sale_date.
      # Must be a scalar (row-level) expression.
      - name: fiscal_qtr_key
        expr: "CONCAT(CAST(YEAR(sale_date) AS STRING), '-Q', CAST(QUARTER(sale_date) AS STRING))"
        data_type: VARCHAR
    metrics:
      - name: total_revenue
        expr: SUM(amount)

relationships:
  - name: sales_to_quarters
    left_table: sales
    right_table: fiscal_quarters
    relationship_columns:
      # The intended fact name appears here — unsupported by this compiler:
      # CONCAT(YEAR, '-Q', QUARTER) per row and uses the result.
      - left_column: fiscal_qtr_key
        right_column: FISCAL_QUARTER_KEY
```

## Gotchas

- **The computed fact is not queryable as a metric or dimension.** It exists only to power the join. Don't expose it to end users.
- **Aggregation expressions are not valid as join keys.** `SUM(...)`, `COUNT(...)`, etc. fail. The fact must be a row-level scalar.
- **The referenced table must have a matching `primary_key`** (or it must be implicit). The right-hand side of the relationship must resolve to a declared PK on the target.
- **Same mechanism powers `time_intelligence`'s shifted joins** (`DATEADD('year', 1, SALE_MONTH)` as a computed FK). If you understand this pattern, that one is just a date-shift application of the same idea.

## Supported representation: a physical computed-key source

Compute the scalar key in an explicitly prepared source SQL view or materialized source. Point the model's base_table at that source and use the resulting physical column in the relationship; do not also declare a same-named computed fact and assume the relationship resolves it.

The shown year/quarter expression is a calendar-quarter illustration, not proof of a business's fiscal calendar. For non-calendar fiscal periods use the actual calendar mapping. Verify expression types, normalization collisions, NULL keys and right-side uniqueness before declaring the relationship. Do not derive an aggregate such as SUM as a row-level join key.

Creating or altering a source object requires authorization for that object; an SV-only task does not grant permission to change arbitrary source tables. When no prepared source is available, report COMPUTED_KEY_UNSUPPORTED and preserve the request rather than dropping the relationship. Use [time intelligence](time_intelligence.md) for aligned-period alternatives.
