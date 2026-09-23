# Entity Facts and Calculated Dimensions

The combined aggregate-fact-to-dimension pattern below is retained as modeling intent, but the current connected ClickZetta release rejects it with `Aggregate function can not be used in DIMENSIONS clause`. This is a remote DDL failure even though the authoring schema and local compiler accept the model. Do not deploy that combined example unchanged.

## How it works

Three composable patterns:

1. **Entity-level aggregated fact** — `expr: SUM(orders.order_amount)` on the parent entity aggregates a child-table column up to that entity. One number per customer. Mark it `access_modifier: private_access` so it is not queryable directly but can still be referenced inside the SV.
2. **Derived dimension from an aggregated fact** — `value_segment` is a `CASE WHEN customers.lifetime_value < 1000 ...` expression. The CASE uses the private fact internally; the user only sees the tier.
3. **Calculated dimension from a physical column** — `age: YEAR(CURRENT_DATE()) - BIRTH_YEAR`. Expression evaluated row-by-row at query time. No stored column needed.

`access_modifier: private_access` is for intermediate computation only — not directly queryable as a public value, but available as an internal expression. Metadata visibility is not an access-control guarantee: CLI readback may retain private definitions, and the configured generation client receives model metadata. Use the default (public) access modifier when users should see/filter by the value directly.

## Combined pattern: non-deployable intent

```yaml-intent
name: entity_facts_example
tables:
  - name: customers
    base_table: { database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: CUSTOMERS }
    primary_key: { columns: [CUSTOMER_ID] }
    facts:
      # Entity-level aggregated fact: aggregates child rows up to the customer.
      # private_access = not directly queryable, but usable in dimensions below.
      - name: lifetime_value
        synonyms: [customer LTV, customer lifetime value, total spend]
        expr: SUM(orders.order_amount)
        access_modifier: private_access

    dimensions:
      # Calculated dimension: expression on a physical column, evaluated at query time
      - name: age
        synonyms: [customer age, age in years]
        expr: YEAR(CURRENT_DATE()) - BIRTH_YEAR
        data_type: NUMBER

      # Derived dimension from the entity-level aggregated private fact
      - name: value_segment
        synonyms: [customer tier, value tier, segment]
        expr: >
          CASE
            WHEN customers.lifetime_value < 1000  THEN 'low'
            WHEN customers.lifetime_value <= 3000 THEN 'medium'
            ELSE                                       'high'
          END
        data_type: VARCHAR

  - name: orders
    base_table: { database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: ORDERS }
    primary_key: { columns: [ORDER_ID] }
    facts:
      - { name: order_amount, expr: AMOUNT, data_type: NUMBER }
relationships:
  - name: orders_to_customers
    left_table: orders
    right_table: customers
    relationship_columns:
      - {left_column: CUSTOMER_ID, right_column: CUSTOMER_ID}
```

## Gotchas

- **Private facts are not public query values.** Query clients must honor the field access modifier. If users need to see the LTV value itself, drop `access_modifier: private_access`.
- **Calculated dimensions are evaluated at query time on every row** — they're cheap for simple expressions (date math, CASE) but consider materializing if the expression is expensive.
- **Entity-level aggregated facts (`SUM(other_table.column)`) require the relationship to be defined.** The aggregation traverses the relationship from the parent entity to the child.
- **Don't confuse `private_access` facts with `non_additive_dimensions` metrics.** `private_access` controls *visibility*; `non_additive_dimensions` controls *aggregation behavior*. Different concerns.

## ClickZetta verification

Prove the entity key and check the complete aggregate-fact consumption expression with actual queries. Parser acceptance does not prove parent-grain aggregation or reaggregation is correct. Compare unjoined and joined totals, no-child entities and NULL amounts. Do not infer privacy or row-level authorization from an authoring flag.

A unique version-row key is different from a business identifier repeated across historical versions. A business-ID membership filter includes all versions of qualifying identities; filtering only the fact's joined version can change the result. Preserve the intended membership predicate and validate that interpretation independently.


## Native aggregate fact and outer classification

A live fixture verified the native aggregate fact for three customers with one/multiple orders. Keep the entity-grain aggregate as a queryable fact and classify its returned value in an outer query. This avoids placing the CASE over an aggregate inside the DIMENSIONS definition. It does not create a reusable native segment dimension; use a prepared entity-level source table/view if the segment must join or group inside the semantic model.

```yaml
name: entity_facts_native_example
tables:
  - name: customers
    base_table: {database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: CUSTOMERS}
    primary_key: {columns: [CUSTOMER_ID]}
    dimensions:
      - {name: customer_id, expr: customers.CUSTOMER_ID}
      - {name: age, expr: "YEAR(CURRENT_DATE()) - customers.BIRTH_YEAR"}
    facts:
      - {name: lifetime_value, expr: "SUM(orders.order_amount)"}
  - name: orders
    base_table: {database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: ORDERS}
    primary_key: {columns: [ORDER_ID]}
    facts:
      - {name: order_amount, expr: orders.AMOUNT}
relationships:
  - name: orders_to_customers
    left_table: orders
    right_table: customers
    relationship_columns:
      - {left_column: CUSTOMER_ID, right_column: CUSTOMER_ID}
```

```sql
SELECT customer_id,
       CASE WHEN lifetime_value < 1000 THEN 'low'
            WHEN lifetime_value <= 3000 THEN 'medium'
            ELSE 'high' END AS value_segment
FROM SEMANTIC_VIEW(TARGET_WORKSPACE.TARGET_SCHEMA.entity_facts_native_example
     DIMENSIONS customers.customer_id FACTS customers.lifetime_value)
```

This retains the original CASE's NULL behavior: a NULL value falls through to `high`. If no-order customers should be a separate category, define that business rule explicitly instead of silently substituting zero. Test entities without children, multiple children, and repeated historical business IDs; a three-row fixture alone does not establish all grain behavior.
