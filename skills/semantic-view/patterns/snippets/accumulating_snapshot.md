# Accumulating Snapshot Fact Table

## How it works

Kimball's **Accumulating Snapshot Fact Table** puts one row per business entity (e.g. one per loan application). Each row has multiple milestone date columns that start NULL and get filled in as the entity moves through stages (applied → reviewed → decided → funded).

In the SV, a **single date dimension alias** serves all milestone paths. Each stage metric declares its own date relationship with `using_relationships`. When grouped by `date_dim.month`, each metric independently uses its own date path — `application_count` buckets by `APPLICATION_DATE`; `funding_count` buckets by `FUNDING_DATE` — in a single query.

This is the multi-path metrics pattern (`using_relationships`) applied to a funnel: one `date_dim`, one relationship per milestone, one metric per stage.

## Snippet

```yaml
name: accumulating_snapshot_example
tables:
  - name: applications
    base_table: { database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: LOAN_APPLICATIONS }
    primary_key: { columns: [APPLICATION_ID] }
    metrics:
      - name: application_count
        expr: COUNT(APPLICATION_ID)
        using_relationships: [app_to_application_date]
      - name: review_count
        expr: COUNT(REVIEW_DATE)
        using_relationships: [app_to_review_date]
      - name: decision_count
        expr: COUNT(DECISION_DATE)
        using_relationships: [app_to_decision_date]
      - name: funding_count
        expr: COUNT(FUNDING_DATE)
        using_relationships: [app_to_funding_date]

  # Single date dimension alias; each metric picks its date path via using_relationships
  - name: date_dim
    base_table: { database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: DIM_DATE }
    primary_key: { columns: [DATE_KEY] }
    dimensions:
      - { name: month, expr: MONTH, data_type: DATE }
      - { name: year,  expr: YEAR,  data_type: NUMBER }

# Four milestone paths — all lead to the same DIM_DATE
relationships:
  - name: app_to_application_date
    left_table: applications
    right_table: date_dim
    relationship_columns: [{ left_column: APPLICATION_DATE, right_column: DATE_KEY }]
  - name: app_to_review_date
    left_table: applications
    right_table: date_dim
    relationship_columns: [{ left_column: REVIEW_DATE,      right_column: DATE_KEY }]
  - name: app_to_decision_date
    left_table: applications
    right_table: date_dim
    relationship_columns: [{ left_column: DECISION_DATE,    right_column: DATE_KEY }]
  - name: app_to_funding_date
    left_table: applications
    right_table: date_dim
    relationship_columns: [{ left_column: FUNDING_DATE,     right_column: DATE_KEY }]
```

## Gotchas

- **Same-period ratios, NOT cohort.** `funding_rate = funding_count / application_count` for January = fundings-in-January ÷ applications-in-January, not "of January applications, how many eventually funded." A January application that funds in February is counted in *February's* `funding_count`, not January's. True cohort analysis requires a different model.
- **`COUNT(milestone_date)` naturally skips NULLs.** This is intentional and what makes the funnel narrow correctly — non-reviewed applications don't count toward `review_count`. Use `COUNT(APPLICATION_ID)` only when you want all rows regardless of stage.
- **NULL row in output when grouping by milestone date** — applications with NULL milestone dates (e.g. unfunded loans grouped by funding date) produce a NULL dimension row. Expected LEFT JOIN behavior.
- **Conversion-rate metrics that reference `using_relationships`-scoped constituents** (e.g. `funding_rate = funding_count / application_count`) should be verified independently. The compiler rejects some nested contextual chains; an outer SQL ratio over the selected role metrics is an explicit alternative when native compilation or results fail.
- **vs `role_playing_dimensions`.** Use accumulating snapshot when one entity moves through sequential stages (`using_relationships` on each metric, shared date dim names). Use role-playing when you have multiple independent date attributes (order date *and* ship date) that analysts need to group by simultaneously (separate alias dim names — `order_year`, `ship_year`).

## ClickZetta verification

Replace source placeholders and compare each stage count with an independent physical query at that stage's date role, then test combined stage output. Retain incomplete milestones as NULL; do not fill them with zero dates. Use matched and unmatched dates and entities crossing calendar periods. Compile and plan before deployment. A period conversion ratio is not a cohort conversion rate; use an explicit cohort definition and query when the business request is cohort-based.
