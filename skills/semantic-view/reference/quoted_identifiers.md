# Identifier and quoting contracts

Names in model JSON/YAML are values; expressions are SQL. Do not put SQL quote characters inside a `name`, base-table component, or generation request's `columnNames` value. The compiler quotes emitted identifier components itself. Case behavior from another platform must not be copied into this adapter.

## Resolve actual metadata first

Use read-only `DESC TABLE` through `cz-cli sql` for physical names and types. A mixed-case label is not proof that the engine resolves it case-sensitively. Preserve the metadata value and check the actual target profile. A missing-object error can be a wrong workspace/schema or a privilege error, not just quoting.

Stored target workspace/schema/view components are restricted by this CLI to ASCII letters, digits and underscores, starting with a letter or underscore. Logical aliases and fields may contain spaces or non-ASCII text. Readback can canonicalize casing; use semantic metadata comparison rather than assuming byte-identical DDL.

| Location | Correct representation | Avoid |
|---|---|---|
| YAML logical name | `name: order date` | Putting literal backticks into the name value |
| Base table component | `table: orders` | A SQL fragment or a full FQN in one component |
| SQL field reference | `` `o`.`order date` `` | `` `o.order date` `` (one identifier) |
| SQL text constant | `'order date'` | Treating it as a column reference |
| Generation request column list | `["customer_id", "amount"]` | Double-encoding SQL quotes into each name |

## Model example

```yaml
name: order_summary
tables:
  - name: o
    base_table: {database: analytics, schema: public, table: orders}
    dimensions:
      - name: order date
        expr: '`o`.`order_date`'
    metrics:
      - name: total revenue
        expr: 'SUM(`o`.`amount`)'
```

```sql
SELECT `order date`, `total revenue`
FROM SEMANTIC_VIEW(analytics.public.order_summary
     DIMENSIONS `o`.`order date` METRICS `o`.`total revenue`)
```

Outer SELECT uses the returned field names; logical table aliases belong inside the semantic invocation. Quote each identifier component separately. An embedded backtick in a logical identifier is escaped by doubling it in SQL; do not apply SQL string-literal escaping to identifiers.

## Request and shell encoding

Use a JSON request file for generation or backend calls and an operations file for edits. JSON syntax quoting and SQL identifier quoting are separate layers. Do not insert untrusted expressions into shell command strings. The compiler separately escapes SQL literals and identifiers; expression validation rejects comments, statement separators and unbalanced groups, but that does not establish business correctness.

Use structured renames. The lexer preserves string literals and function names when rewriting references; verify SQL after changes involving same-named physical and logical fields. A renamed label must not accidentally rename its physical source column.

## Diagnose failures

- JSON parse failure: inspect the saved JSON, not engine metadata.
- Local invalid target: choose a supported stored object name; quoting does not bypass the target constraint.
- Unknown physical column: compare the expression with DESC output and the source binding.
- Unknown semantic output column: inspect returned field names and remove outer logical qualifiers.
- Remote canonicalization conflict: compare structured definitions and intended business behavior before replacing a view.
