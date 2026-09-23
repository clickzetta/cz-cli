# Window Metrics (LAG, Rolling Average, YTD)

## How it works

Window metrics use SQL window functions (`AVG OVER`, `LAG`, `SUM OVER`) inside metric expressions to span time. Three patterns:

1. **Rolling average** — `AVG(metric) OVER (... ORDER BY date RANGE BETWEEN INTERVAL 6 DAYS PRECEDING AND CURRENT ROW)` for a 7-day moving average.
2. **LAG** — `LAG(metric, n) OVER (... ORDER BY date)` returns the value `n` rows ago in the same partition. NULL for the first `n` rows.
3. **YTD cumulative sum** — `SUM(metric) OVER (PARTITION BY year ORDER BY date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)`. The `PARTITION BY year` resets the running total at each year boundary.

Spell out the partition columns explicitly. If users may add new dimensions later, list them all in `PARTITION BY` so each combination gets its own window.

## Snippet

```yaml
name: window_metrics_example
tables:
  - name: daily_sales
    base_table: { database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: DAILY_SALES }
    primary_key: { columns: [SALE_DATE, CHANNEL] }
    dimensions:
      - { name: sale_date, expr: SALE_DATE, data_type: DATE }
      - { name: channel,   expr: CHANNEL,   data_type: VARCHAR }
    metrics:
      - name: total_revenue
        expr: SUM(REVENUE)

      - name: rolling_7d_avg_revenue
        synonyms: [7 day rolling average, 7-day avg, weekly rolling average]
        expr: >
          AVG(SUM(REVENUE))
          OVER (PARTITION BY CHANNEL
                ORDER BY SALE_DATE
                RANGE BETWEEN INTERVAL 6 DAYS PRECEDING AND CURRENT ROW)

      - name: revenue_30_rows_ago
        synonyms: [revenue 30 observations ago, lag 30 observed periods]
        expr: >
          LAG(SUM(REVENUE), 30)
          OVER (PARTITION BY CHANNEL
                ORDER BY SALE_DATE)

      - name: ytd_revenue
        synonyms: [year to date revenue, YTD revenue, cumulative revenue]
        expr: >
          SUM(SUM(REVENUE))
          OVER (PARTITION BY YEAR(SALE_DATE), CHANNEL
                ORDER BY SALE_DATE
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
```

## Gotchas

- **Window metrics require their `ORDER BY` dimension in the query's dimensions** — otherwise the engine has nothing to order by.
- **Specify the intended partition.** Per-channel calculations need channel partitioning; a global calculation may not. Do not add arbitrary partitions to suppress an error. Validate the exact expression against the connected release.
- **`LAG(n)` returns NULL for the first n rows** — expected behavior, but surfaces as missing data in the earliest period.
- **Spell out every partitioning dimension.** If you later add a new dimension (e.g. `region`) and want each region to have its own window, you must edit the metric to add it to `PARTITION BY`.
- **YTD vs `time_intelligence`**: this pattern is for cumulative running totals (YTD/QTD/MTD). For point-in-time period comparisons (SPLY, YoY%) use `time_intelligence.md` — different alignment requirement and output semantics. Computed-fact relationship keys are blocked here; the reference describes supported physical-key or query-time alternatives.

## ClickZetta verification

Request the relevant partition/order dimensions and inspect actual output names. LAG 30 means 30 observed rows, not 30 calendar days unless the calendar is dense at exactly daily grain. A RANGE frame follows date distance; verify its dialect support and the treatment of absent dates before substituting a ROWS frame. For YTD verify resets and that the input retains earlier dates needed by the window; filtering the input down to one day can remove required history.

Run `sv compile`, connected `sv plan` and compare complete results on tied dates, gaps, multiple channels and year boundaries. The template demonstrates intended shapes; each window form needs a connected check before deployment. Do not claim all window expressions are supported because one cumulative metric works.
