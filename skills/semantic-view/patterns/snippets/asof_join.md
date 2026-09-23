# ASOF Join

## How it works

When a dimension table has only a `start_date` (no explicit `end_date`), an ASOF join finds the dimension row with the largest `start_date` that is `<=` the event date for the same key. This is the "as-of" record — the one that was in effect *as of* the event.

Two requirements:

1. **`primary_key` (or `unique_keys`) on `(key, start_date)`** on the dimension table — no end date column needed.
2. **`type: asof`** on the date column inside the relationship's `relationship_columns`. Pair it with a regular `left_column`/`right_column` entry for the entity key.

The SV resolves the historically-correct dimension row automatically — no date-range filtering, no row-numbered sub-query, no ETL view.

## Snippet

```yaml
name: asof_join_example
tables:
  - name: Customer_address
    base_table: { database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: CUSTOMER_ADDRESS }
    primary_key: { columns: [CA_CUSTID, CA_START_DATE] }
    dimensions:
      - name: zip
        synonyms: [zip code, postal code, delivery zip]
        expr: CA_ZIPCODE
        data_type: VARCHAR

  - name: Orders
    base_table: { database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: ORDERS }
    primary_key: { columns: [O_ORDID] }
    metrics:
      - name: total_revenue
        synonyms: [revenue, order revenue, total order value]
        expr: SUM(O_AMOUNT)

relationships:
  - name: orders_to_addr
    left_table: Orders
    right_table: Customer_address
    relationship_columns:
      - left_column: O_CUSTID
        right_column: CA_CUSTID
      # ASOF: for each order, find the address row with the largest
      # CA_START_DATE that is <= O_ORDDATE for the same customer.
      - left_column: O_ORDDATE
        right_column: CA_START_DATE
        type: asof
```

## Gotchas

- **Wrong without `type: asof`.** Joining only on the customer key (no date qualifier) can multiply facts across historical rows or attribute them to the wrong effective record. An ordinary equality join does not select the valid historical version. The pattern's whole purpose is to prevent that mistake.
- **Dimension uniqueness on `(key, start_date)` is required.** Without it the engine cannot resolve the "latest on or before" semantics.
- **Only a `start_date` column is supported.** If you have explicit `start_date` + `end_date` (SCD2 with closed periods) read [range joins](range_join.md) for an explicitly bounded preprocessing alternative. Native range relationships are blocked in the verified ClickZetta dialect; ASOF alone does not enforce VALID_TO.
- **Cross-period dimension breakdowns work as expected** when the breakdown lives on the dimension itself (e.g. `Customer_address.zip`). The ASOF resolution happens before grouping.

## ClickZetta verification

Use the actual source schema and verify uniqueness of (customer key, start date). Run `sv compile`, connected `sv plan` and result comparisons for before-first, exact-boundary, between-version, after-last, NULL event time and duplicate effective timestamps. Do not claim every query combination is supported from ASOF syntax alone. Preserve actual errors and job IDs. Do not change a source table's nullability merely because another engine had a planner issue; reproduce and scope any required workaround on this deployment.
