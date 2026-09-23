# Multi-Fact Table

## How it works

Multiple independent fact tables share common dimensions in one SV. Each fact has its own metrics; cross-fact derived metrics combine them (`total_gross = store + web`; `net = gross - returns`).

The pattern:

1. **Each fact is a separate entry in `tables:`.**
2. **Each fact joins to the shared dimensions** via its own relationships (`store_to_date`, `web_to_date`, `returns_to_date`, ...).
3. **Cross-fact derived metrics** live at the top-level `metrics:` block and reference metrics from multiple fact entities by their entity-prefixed names.

The engine is selective: querying only `store_revenue` does not join `channel_web_sales`. Querying `total_gross_revenue` triggers joins/aggregation across both. Inspect the model's relationship graph to identify dimensions reachable from each fact; then validate the requested combination against the connected engine.

## Snippet

```yaml
name: multi_fact_table_example
tables:
  - name: dim_product
    base_table: { database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: DIM_PRODUCT }
    primary_key: { columns: [PRODUCT_ID] }
    dimensions:
      - { name: product_id, expr: PRODUCT_ID }

  - name: channel_dim_date
    base_table: { database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: DIM_DATE }
    primary_key: { columns: [DATE_ID] }
    dimensions:
      - { name: date_id, expr: DATE_ID }

  - name: channel_store_sales
    base_table: { database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: STORE_SALES }
    metrics:
      - { name: store_revenue, expr: SUM(REVENUE) }

  - name: channel_web_sales
    base_table: { database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: WEB_SALES }
    metrics:
      - { name: web_revenue, expr: SUM(REVENUE) }

  - name: channel_returns
    base_table: { database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: RETURNS }
    metrics:
      - { name: total_returns, expr: SUM(AMOUNT) }

# Each fact joins to BOTH shared dimensions
relationships:
  - { name: store_to_date,    left_table: channel_store_sales, right_table: channel_dim_date,
      relationship_columns: [{ left_column: DATE_ID, right_column: DATE_ID }] }
  - { name: store_to_product, left_table: channel_store_sales, right_table: dim_product,
      relationship_columns: [{ left_column: PRODUCT_ID, right_column: PRODUCT_ID }] }
  - { name: web_to_date,      left_table: channel_web_sales,   right_table: channel_dim_date,
      relationship_columns: [{ left_column: DATE_ID, right_column: DATE_ID }] }
  - { name: web_to_product,   left_table: channel_web_sales,   right_table: dim_product,
      relationship_columns: [{ left_column: PRODUCT_ID, right_column: PRODUCT_ID }] }
  - { name: returns_to_date,    left_table: channel_returns,   right_table: channel_dim_date,
      relationship_columns: [{ left_column: DATE_ID, right_column: DATE_ID }] }
  - { name: returns_to_product, left_table: channel_returns,   right_table: dim_product,
      relationship_columns: [{ left_column: PRODUCT_ID, right_column: PRODUCT_ID }] }

# Cross-fact derived metrics — top-level, NOT nested inside any tables[].metrics
metrics:
  - name: total_gross_revenue
    expr: channel_store_sales.store_revenue + channel_web_sales.web_revenue
  - name: net_revenue
    expr: total_gross_revenue - channel_returns.total_returns
```

## Gotchas

- **The engine is selective about joins.** Don't worry that listing 3 facts means every query joins all 3 — querying `store_revenue` alone joins only `channel_store_sales` and the dims it actually uses.
- **Cross-fact derived metrics trigger joins across all referenced facts.** `total_gross_revenue` requires both `channel_store_sales` and `channel_web_sales` to be joined to a common dimension grain. Make sure both facts share the dimension you group by.
- **Each fact must join independently to shared dims.** You cannot rely on `store → web → product` transitively; declare `store → product` and `web → product` directly.
- **Beware fan traps.** If a metric is at a coarser grain than the dimension you group by, the query may be rejected or produce an unintended grain; validate the exact shape and totals. See `sv_diagnostics.md` (#2 Fan Trap).
- **Use `cz-cli sv read` and `sv query`** to inspect declared paths and validate the dimensions applicable to each metric. Do not assume a metadata command from another engine exists.

## ClickZetta verification

This is a complete authoring template; replace source names with actual tables and verify physical columns and keys before deployment. Each independent fact must connect to every shared grouping dimension used by a cross-fact metric. Do not replace these independent paths with raw fact-to-fact joins.

Use `sv compile`, then `sv plan` on the selected profile. Compare each fact's total against its physical aggregate before testing the combined metric. Include disjoint dimension members, missing fact groups, NULL amounts and nonunique dimension keys. A missing channel aggregate may be NULL; whether it contributes zero is a business definition, not an automatic rewrite. Validate any desired COALESCE explicitly.

The template's `net_revenue` references a derived metric. The CLI expands supported scalar chains; contextual window/USING/non-additive chains can be rejected. Read [derived metrics](derived_metrics.md) before adding them. Native join selection and cross-fact behavior require actual queries, not just a successful YAML parse.
