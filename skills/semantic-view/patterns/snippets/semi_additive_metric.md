# Semi-Additive Metric

## How it works

A snapshot fact (account balance, headcount, inventory) records a value at a point in time. Summing across **accounts** on the same date is correct. Summing across **dates** double-counts: a balance of $1,000 on Monday and $1,000 on Tuesday is still $1,000, not $2,000.

`non_additive_dimensions` marks a metric as non-aggregatable across the named time dimension. When `balance_date` is in the query's dimensions, the metric sums across other dimensions for that date. When the boundary dimension is omitted, the verified ClickZetta behavior selects the final boundary in the specified ordering. ASC chooses the latest date, DESC the earliest. Confirm the entity grouping and filtering semantics with actual queries.

You typically need **two metrics** with non-overlapping synonyms:

- One metric with `non_additive_dimensions` for point-in-time totals (e.g. `total_balance`).
- One plain `AVG` metric for trends (e.g. `avg_daily_balance`).

A period average and a selected-boundary total are different calculations. Define their underlying grain separately instead of assuming AVG of a selected-boundary metric supplies a time average.

## Snippet

```yaml
name: semi_additive_metric_example
tables:
  - name: balances
    base_table: { database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: ACCOUNT_BALANCES }
    primary_key: { columns: [ACCOUNT_ID, BALANCE_DATE] }
    dimensions:
      - { name: balance_date, expr: BALANCE_DATE, data_type: DATE }
    metrics:
      - name: total_balance
        synonyms:
          [current balance, balance as of date, snapshot balance,
           end of day balance, point in time balance, balance on hand]
        description: Total balance at the selected snapshot date; verify the requested entity grouping.
        expr: SUM(BALANCE_USD)
        # Prevents the engine from summing across balance_date.
        # ASC selects the latest boundary in the verified dialect.
        # Validate grouping and sparse snapshots before using this total.
        non_additive_dimensions:
          - table: balances
            dimension: balance_date
            sort_direction: ascending
            null_order: last

      - name: avg_daily_balance
        synonyms:
          [average balance, average daily balance, mean balance,
           typical balance, balance trend]
        description: Average non-null account-snapshot row balance; not an average of daily portfolio totals.
        expr: AVG(BALANCE_USD)
```

## Gotchas

- **Double-counting if you forget `non_additive_dimensions`.** A naive `SUM(balance)` across a snapshot table inflates by the number of snapshot dates. This is the silent failure the pattern prevents.
- **Keep boundary totals and averages separate.** AVG(BALANCE_USD) averages rows, not daily portfolio totals. For the latter aggregate each day first, then average at the intended reporting scope; sparse snapshots need explicit treatment.
- **Synonym discipline matters.** If both metrics mention "balance" without intent qualifiers, the AI may pick the wrong one. Use intent-oriented synonyms: `total_balance` → "current balance", "snapshot balance", "balance as of"; `avg_daily_balance` → "average", "trend", "typical".
- **Make the requested time boundary explicit.** Validate queries with and without the time dimension, as well as date filters. Selecting the latest observed row is not proof of correct carry-forward across missing days.

## ClickZetta verification

Compile and plan the complete model. Compare results against physical boundary selection for multiple entities with different last dates, missing periods and NULL dates. Verify whether the intended result uses one shared reporting date or an independently selected last observation per entity; do not silently interchange them. A snapshot count or balance is not additive across time merely because a SUM expression compiles.
