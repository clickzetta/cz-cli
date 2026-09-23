# Role-Playing Dimensions

## How it works

A fact has two FKs that both point to the same physical dimension table (`ORDER_DATE` and `SHIP_DATE` both → `DIM_DATE`). List the same physical table under two different logical aliases. The SV engine treats each alias as a completely separate entity — separate joins, separate dimension columns, no ambiguity, no `using_relationships` needed.

Each alias gets its own *uniquely named* dimension columns (`order_year`, `ship_year` — both physically `YEAR` in `DIM_DATE`). Analysts can use them independently or together in the same query (cross-tab — e.g. fulfillment lag analysis).

## Snippet

```yaml
name: role_playing_dimensions_example
tables:
  - name: orders
    base_table: { database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: ORDERS }
    primary_key: { columns: [ORDER_ID] }
    metrics:
      - name: total_revenue
        expr: SUM(AMOUNT)

  # Same physical DIM_DATE aliased under two logical names
  - name: order_date_dim
    base_table: { database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: DIM_DATE }
    primary_key: { columns: [DATE_KEY] }
    dimensions:
      - { name: order_year,       expr: YEAR,       data_type: NUMBER,  synonyms: [order year, year ordered] }
      - { name: order_month_name, expr: MONTH_NAME, data_type: VARCHAR, synonyms: [order month, month ordered] }

  - name: ship_date_dim
    base_table: { database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: DIM_DATE }
    primary_key: { columns: [DATE_KEY] }
    dimensions:
      - { name: ship_year,       expr: YEAR,       data_type: NUMBER,  synonyms: [ship year, shipped year] }
      - { name: ship_month_name, expr: MONTH_NAME, data_type: VARCHAR, synonyms: [ship month, month shipped] }

relationships:
  - name: orders_to_order_date
    left_table: orders
    right_table: order_date_dim
    relationship_columns:
      - { left_column: ORDER_DATE, right_column: DATE_KEY }
  - name: orders_to_ship_date
    left_table: orders
    right_table: ship_date_dim
    relationship_columns:
      - { left_column: SHIP_DATE, right_column: DATE_KEY }
```

## Gotchas

- **Use independently named role dimensions.** Prefixing `order_year` and `ship_year` clarifies output meaning and avoids ambiguous references. Do not assume that every duplicate unqualified name is rejected at deployment; validate the actual query/output contract.
- **Single alias + two relationships → ambiguity error.** If you define only one `date_dim` alias but two relationships pointing to it, grouping by `date_dim.year` can be ambiguous when the intended metric path is not specified. You can fix this by either using two aliases (this pattern) or adding `using_relationships` on every metric (`multi_path_metrics.md` / `accumulating_snapshot.md`).
- **Sparse `DIM_DATE` produces NULL dimension values.** SV uses LEFT JOINs. Populate `DIM_DATE` for the full date range of the fact table.
- **Cross-tab grows fast.** Grouping by `order_month` and `ship_month` together produces one row per unique combination. Useful for lag analysis, but can produce many rows if orders span many months.
- **vs `multi_path_metrics`:** use role-playing when each role needs its own independently named columns and analysts want both in one query. Use `multi_path_metrics` (`using_relationships`) when the dimension column is shared and disambiguation should happen at the metric level.
- **vs `accumulating_snapshot`:** use role-playing for independent date attributes (order date *and* ship date used together). Use accumulating snapshot when one entity moves through sequential stages (each metric uses one stage's date via `using_relationships`).

## ClickZetta verification

Replace the source placeholders and validate keys. Query order year alone, ship year alone and their cross-tab; compare each with an independently written physical query using the same roles. Include orders with missing shipment dates and unmatched date keys. Left-join dimension NULLs do not implement a requested inner-join existence restriction; preserve that business condition explicitly when required.

The selector uses `order_date_dim.order_year` or `ship_date_dim.ship_year`; inspect actual returned output columns for the outer SELECT rather than reusing internal table qualifiers blindly. Compile and plan the complete template before authorized deployment.
