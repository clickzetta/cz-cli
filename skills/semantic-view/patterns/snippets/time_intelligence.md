# Time Intelligence (SPLY, YoY, MoM)

## How it works

A period comparison aligns a prior-period fact with a current reporting bucket. Keep three concepts separate: the fact's actual event date, the reporting bucket used for alignment, and the business calendar's definition of the previous comparable period.

The shifted-role design uses a current fact alias, a prior-period alias, and a shared calendar. For reporting month March 2024, current sales come from March 2024 and the aligned prior-year alias selects March 2023. This differs from a running YTD total and from LAG over an incomplete sequence of observed rows.

A logical computed-fact relationship key is blocked in the verified ClickZetta dialect. Preserve the shifted-key method by preparing a physical aligned-key source, or perform explicit period alignment outside a semantic aggregation. Do not claim native support merely because the expression can be stored as a scalar fact.

## Complete physical-key template

This template requires an authorized, already prepared FACT_SALES_ALIGNED source that retains every original sales row and supplies SALE_MONTH and SALE_MONTH_ALIGNED_LY. The latter maps an actual month to its corresponding next-year reporting bucket. For a nonstandard fiscal calendar use the approved calendar mapping instead of assuming an arithmetic year shift.

```yaml
name: aligned_sales_periods
tables:
  - name: calendar
    base_table: {database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: DIM_CALENDAR}
    primary_key: {columns: [MONTH]}
    dimensions:
      - {name: month, expr: MONTH, data_type: DATE, is_time: true}
      - {name: year, expr: YEAR, data_type: NUMBER}
  - name: sales
    base_table: {database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: FACT_SALES_ALIGNED}
    primary_key: {columns: [ROW_ID]}
    metrics:
      - {name: total_revenue, expr: SUM(REVENUE)}
  - name: sales_ly
    base_table: {database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: FACT_SALES_ALIGNED}
    primary_key: {columns: [ROW_ID]}
    metrics:
      - name: revenue_ly
        synonyms: [revenue last year, prior year revenue, SPLY]
        expr: SUM(REVENUE)
relationships:
  - name: sales_to_calendar
    left_table: sales
    right_table: calendar
    relationship_columns:
      - {left_column: SALE_MONTH, right_column: MONTH}
  - name: sales_ly_to_calendar
    left_table: sales_ly
    right_table: calendar
    relationship_columns:
      - {left_column: SALE_MONTH_ALIGNED_LY, right_column: MONTH}
```

Query both metrics at the shared calendar month. Verify the native multi-fact/alias combination before deploying it. If it cannot preserve the intended grain, use separately verified semantic aggregates joined by explicit period keys; do not silently compare adjacent available rows.

## Gotchas

- The earliest period may lack a prior counterpart. NULL and zero express different business meanings; only zero-fill when defined.
- YTD/QTD/MTD are cumulative calculations, not fixed-period shifts. Use [window metrics](window_metrics.md) with correct calendar boundaries.
- Partial periods need an agreed cutoff on both sides. A full previous month is not automatically comparable to month-to-date.
- Leap days, 53-week calendars and gaps require a business rule. A unique month key alone does not establish correct comparable periods.
- Define shared breakdown dimensions and paths for both aliases. Do not assume a filter on the current entity automatically propagates to a different role.
- Calculate a percentage using a denominator consistent with the definition, guard division by zero, and distinguish ratio from percentage display. Do not infer support for contextual derived chains from a working scalar ratio.
- If preparation of a source view is outside scope, report that dependency or use an authorized readonly hybrid query. Do not alter original source tables without authorization.

## Verification

Compile the template with real source bindings, plan on the selected profile and compare both series with independent physical queries for boundary periods, missing periods, partial periods and at least one shared non-time dimension. Test exact aligned membership as well as final sums. Record the preparation definition and query job IDs so a correct number is not mistaken for a correct calendar mapping.
