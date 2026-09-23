# AI Metadata

## How it works

Three authoring fields express guidance beyond structural definitions:

1. `module_custom_instructions.sql_generation`: business computation, formatting and disambiguation guidance for a consuming query-generation client.
2. `module_custom_instructions.question_categorization`: intended topic scope and clarification guidance.
3. `verified_queries`: specific business questions paired with reviewed SQL examples and optional verification provenance.

In ClickZetta these instructions are integrity-checked managed metadata consumed by the CLI generation path, not native AI_SQL_GENERATION or AI_QUESTION_CATEGORIZATION clauses. Other clients may ignore them. The current CLI does not implement a separate guaranteed classification stage, AUTO/REQUIRE modes or guaranteed verbatim VQR replay. Do not promise those behaviors merely because the metadata fields exist.

## Complete template

```yaml
name: orders_guidance
tables:
  - name: orders
    base_table: {database: TARGET_WORKSPACE, schema: TARGET_SCHEMA, table: ORDERS}
    primary_key: {columns: [ORDER_ID]}
    dimensions:
      - {name: order_status, expr: STATUS, description: Order lifecycle status.}
    metrics:
      - {name: order_count, expr: COUNT(ORDER_ID)}
      - {name: recorded_amount, expr: SUM(AMOUNT)}
module_custom_instructions:
  sql_generation: |
    Distinguish order count from recorded order amount.
    When an amount is requested, state the reporting scope and retain its stored currency unit.
    If the supplied business definition excludes refunded orders, apply that rule explicitly.
  question_categorization: |
    This model covers order counts and recorded amounts by lifecycle status.
    Identify requests requiring customer-level attributes or margins that this model does not define.
verified_queries:
  - name: orders_by_status
    question: How many orders are recorded in each lifecycle status?
    sql: >
      SELECT order_status, order_count
      FROM SEMANTIC_VIEW(TARGET_WORKSPACE.TARGET_SCHEMA.orders_guidance
        DIMENSIONS orders.order_status METRICS orders.order_count)
      ORDER BY order_status
```

The example is a candidate, not a certified VQR. Replace source/target names, execute it and compare with an independent physical count. Add actual reviewer and verification time only after that work; `verified_at` convention is epoch seconds, not an invented date or approval.

## Gotchas

- Prefer a semantically appropriate native SV example when it expresses the intended question correctly. Physical SQL examples are also valid in the current authoring schema; there is no AUTO/REQUIRE restriction to invent.
- Specific questions are more useful than vague examples such as "show revenue." Record grain, period or exclusions when they disambiguate the answer.
- Instructions are not security controls. A text instruction to decline sensitive questions does not enforce row/column access.
- A description or instruction does not create a missing metric, relationship or filter. Verify structural coverage separately.
- Scope guidance can affect generated answers. Test both in-scope questions and boundary questions, but do not equate stored text with an enforced classifier.
- A syntactically valid VQR is not proof of its business meaning. Preserve original SQL, source history and validation evidence when editing or transforming it.

## Verification

Use `sv read` after authorized deployment to confirm native and managed metadata status. Test the actual consumer (`sv query --question` when that is the intended path), record generated SQL and EXPLAIN/execution evidence, and confirm whether the guidance was followed. An outer Agent that reads YAML and writes SQL is a different consumer; evaluate its behavior separately. Never claim guaranteed reuse because a question resembles a saved example.
