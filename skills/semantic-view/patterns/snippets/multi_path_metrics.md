# Multi-Path Metrics (`using_relationships`)

## How it works

A fact can have two foreign keys pointing to the same dimension: flights with departure and arrival airports, or orders with bill-to and ship-to addresses. A metric grouped by that shared dimension needs an unambiguous business path.

1. Define one relationship per role.
2. Add `using_relationships` to the metric to select the intended path.
3. Use separate role metrics for side-by-side comparisons. Do not resolve ambiguity by arbitrarily deleting a valid relationship.

## Complete template

The example uses physical equality keys supported by the connected dialect. Temporal weather lookup is a separate requirement; do not silently drop its time boundary to make a range relationship compile.

```yaml
name: flight_role_metrics
tables:
  - name: flights
    base_table: {database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: FLIGHTS}
    primary_key: {columns: [FLIGHT_ID]}
    metrics:
      - name: late_departure_count
        synonyms: [late departures, delayed departures]
        description: Number of late flights attributed to the departure airport.
        expr: SUM(CASE WHEN IS_LATE THEN 1 ELSE 0 END)
        using_relationships: [flight_departure_airport]
      - name: late_arrival_count
        synonyms: [late arrivals, delayed arrivals]
        description: Number of late flights attributed to the arrival airport.
        expr: SUM(CASE WHEN IS_LATE THEN 1 ELSE 0 END)
        using_relationships: [flight_arrival_airport]
      - name: total_flights
        expr: COUNT(FLIGHT_ID)
  - name: airports
    base_table: {database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: AIRPORTS}
    primary_key: {columns: [AIRPORT_CODE]}
    dimensions:
      - {name: airport_city, expr: CITY_NAME}
relationships:
  - name: flight_departure_airport
    left_table: flights
    right_table: airports
    relationship_columns:
      - {left_column: DEPARTURE_AIRPORT, right_column: AIRPORT_CODE}
  - name: flight_arrival_airport
    left_table: flights
    right_table: airports
    relationship_columns:
      - {left_column: ARRIVAL_AIRPORT, right_column: AIRPORT_CODE}
```

## Gotchas

- A named relationship must exist in the model and lead from the metric's entity along the intended role. The CLI emits `USING (relationship) AS expression`.
- A plain total metric may work without a dimension but remain ambiguous when grouped by the shared dimension. Check the actual queried combination.
- Distinct role metrics with the same aggregate expression are intentional; do not remove one as a duplicate expression.
- When both role attributes must be selected independently in one result, consider [role-playing dimensions](role_playing_dimensions.md) instead of forcing a single shared dimension column to mean two things.
- Equality lookup by airport does not implement effective-time lookup by weather validity. See [ASOF](asof_join.md) and [range joins](range_join.md) for the separately verified temporal contract.

## Verification

Replace physical names and prove the right-side key. Compile, then plan against the selected profile. Query departure and arrival counts separately by airport city and compare with physical aggregates using the corresponding key; then test their joint projection. Include airports serving only one role, missing keys and NULL indicators. Preserve the business distinction between flight count and event/segment count. Record the exact query, result and job ID before claiming the two paths work together.
