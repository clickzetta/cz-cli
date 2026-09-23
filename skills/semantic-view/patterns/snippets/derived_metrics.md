# Derived Metrics

## How it works

A derived metric combines other metrics — typically across multiple entities — into a new metric that lives at the SV level (not scoped to a single entity). Examples: `total_revenue = store + web + catalog`; `store_pct = store / total`.

Two rules:

1. **Cross-table derived metrics live at the top-level `metrics:` block of the YAML** — not nested under any `tables[].metrics`.
2. **Constituent references on the right side keep their entity prefix** — `store_sales.store_revenue + web_sales.web_revenue`.

A scalar derived metric can reference other scalar derived metrics. The CLI expands supported chains to base metric references; it rejects contextual chains when safe expansion has not been established.

## Snippet

```yaml
name: derived_metrics_example
tables:
  - name: store_sales
    base_table: {database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: STORE_SALES}
    metrics:
      - name: store_revenue
        expr: SUM(REVENUE)
  - name: web_sales
    base_table: {database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: WEB_SALES}
    metrics:
      - name: web_revenue
        expr: SUM(REVENUE)
  - name: catalog_sales
    base_table: {database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: CATALOG_SALES}
    metrics:
      - name: catalog_revenue
        expr: SUM(REVENUE)

# Cross-table derived metrics live HERE (top-level), not nested under any table.
metrics:
  - name: total_revenue
    synonyms: [total sales, all channel revenue, combined revenue]
    expr: store_sales.store_revenue + web_sales.web_revenue + catalog_sales.catalog_revenue

  - name: store_pct_of_total
    synonyms: [store share, store contribution, "% from store"]
    expr: store_sales.store_revenue / NULLIF(total_revenue, 0)
```

## Gotchas

- **Top-level `metrics:` placement is required for cross-table derivations.** Nesting a cross-table derived metric under one of the `tables[].metrics` arrays will fail or behave unexpectedly. Only single-table aggregations belong in `tables[].metrics`.
- **Division returns a decimal (0.0–1.0), not a percent.** Multiply × 100 in standard SQL wrapping for display as `%`.
- **All referenced metrics must be reachable via the same set of relationships/dimensions in the query.** If `store_sales` and `web_sales` only join through `dim_date`, you can't break the derived `total_revenue` down by a dimension that only one of them has.
- **A derived expression does not imply additivity.** Ratios must be recomputed at the requested grain. Define any non-additive behavior on the appropriate constituent and validate its combination; do not assume contextual behavior is inherited through an arbitrary expression.

## ClickZetta verification

This template supplies physical bindings for scalar cross-fact totals. For a dimensional breakdown, add the shared dimensions and independent relationships from [multiple fact tables](multi_fact_table.md); bindings alone do not provide a join path.

Validate division by zero, NULL/missing channel totals, numeric precision and weighted totals. `SUM(amount) / COUNT(*)` is not the same as AVG(amount) when amount can be NULL. Choose the denominator from the business definition. Test both an individual group and its rolled-up total; summing group ratios is generally incorrect. Use `sv compile`, connected `sv plan` and actual result comparisons before declaring support.
