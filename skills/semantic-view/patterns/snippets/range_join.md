# Range Join (SCD2 Temporal)

> Native deployment of this representation is blocked in the verified ClickZetta dialect. The following preserves the modeling intent and input shape; it is not a supported deployable recipe. Use the explicit alternative below and verify its business equivalence.

## How it works

When a dimension table has explicit `valid_from` + `valid_to` columns (SCD2), a range join finds the single dimension row whose validity period contains the fact event date.

Three pieces:

1. **Declare the time range on the dimension** — `unique_keys` on `(key, valid_from, valid_to)` plus a `constraints[].distinct_range` block naming the start/end columns.
2. **Compound relationship** matches on the key *and* uses `type: range` + `right_range` for the date column.
3. **Use dimensions from the dimension table** — they automatically resolve to the historically-correct record per fact row.

`EXCLUSIVE` end semantics: `valid_to` is the first day the record is *no longer* active. An order on `2024-04-01` falls in `[2024-04-01, 2024-07-01)` → that period's segment.

## Snippet

```yaml-intent
name: range_join_intent
tables:
  - name: customer_segments
    base_table: { database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: CUSTOMER_SEGMENTS }
    primary_key: { columns: [SEGMENT_ID] }
    unique_keys:
      - columns: [CUSTOMER_ID, VALID_FROM, VALID_TO]
    constraints:
      - name: segment_period
        distinct_range:
          start_column: VALID_FROM
          end_column: VALID_TO
    dimensions:
      - name: segment
        synonyms: [tier, subscription tier, plan, customer plan]
        expr: SEGMENT
        data_type: VARCHAR(20)

  - name: orders
    base_table: { database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: ORDERS }
    primary_key: { columns: [ORDER_ID] }
    metrics:
      - name: total_revenue
        expr: SUM(ORDER_AMOUNT)

relationships:
  - name: orders_to_segment
    left_table: orders
    right_table: customer_segments
    relationship_columns:
      - left_column: CUSTOMER_ID
        right_column: CUSTOMER_ID
      # Range join: ORDER_DATE must fall within [VALID_FROM, VALID_TO)
      - left_column: ORDER_DATE
        type: range
        right_range:
          start_column: VALID_FROM
          end_column: VALID_TO
```

## Gotchas

- **Inclusive vs exclusive end dates.** This pattern uses `EXCLUSIVE` semantics — `valid_to` is the first day the record is no longer active. If your data uses inclusive end dates (`valid_to = 2024-03-31` means active *through* that day), convert at load time or wrap with a view that adds 1 day.
- **Type compatibility.** The fact's temporal column must be type-coercible to the dimension's range columns. If your fact has `DATE` but the dimension has `TIMESTAMP_NTZ`, perform the cast in the explicitly prepared physical source view. A computed fact is not a supported native relationship key here.
- **Entity isolation across range joins.** You cannot use a dimension from a range-joined entity with a metric defined on a *different* entity that is only connected through that range join. If a second fact (e.g. `support_tickets`) is not directly related to `customer_segments`, you cannot break down its metrics by `customer_segments.segment`. Add the dimension directly to the second fact's entity, or establish a direct relationship.
- **No end date column?** Use `asof_join.md` instead — `type: asof` finds the latest record on or before the event without needing a `valid_to`.

## Supported representation: resolve the version in a physical source

Within authorization, prepare a source SQL view (or materialized source) that retains one row per fact and resolves its version key with the intended predicate:

```sql
SELECT o.ORDER_ID, o.ORDER_AMOUNT, s.SEGMENT_ID
FROM ORDERS o
LEFT JOIN CUSTOMER_SEGMENTS s
  ON o.CUSTOMER_ID = s.CUSTOMER_ID
 AND o.ORDER_DATE >= s.VALID_FROM
 AND (o.ORDER_DATE < s.VALID_TO OR s.VALID_TO IS NULL)
```

This example assumes a NULL upper bound means open-ended; confirm that definition before using it. Qualify actual source names, verify compatible types and preserve additional required columns. Check overlapping intervals first: two matching segments multiply a fact, so do not declare the output key unique until verified. Gaps should remain unmatched unless the business definition says otherwise.

Bind the prepared source as a logical fact table and equijoin its physical SEGMENT_ID to the proven dimension key. Compile/plan the supported model and compare revenue and row counts against the physical predicate, including exact endpoints, gaps, overlaps and NULLs. Do not silently use ASOF when an upper bound matters. If creating a source view is outside scope, return the explicit capability gap or use an authorized readonly hybrid query instead.
