# Query an existing semantic view

Use this guide when answering an analysis question with an existing model. Respect a read-only task: an incomplete model does not authorize redeployment.

## Match the question to actual coverage

Read the relevant deployed definition or trusted readback once, retaining its identity. Check the requested grain, named metric/fact expressions, filtering columns, role-specific relationships and output requirements. A model description saying it covers a domain is not enough. A physical source column is usable inside SEMANTIC_VIEW only when the model exposes it in the required role.

Choose a supported path with the least unnecessary work:

| Coverage | Query choice |
|---|---|
| Metric, dimensions and relevant relationship paths match | Compose a native SEMANTIC_VIEW query; use outer SQL for aliases, sorting and requested limits |
| Missing named aggregate but the required raw fact is exposed | Consider a same-table FACTS projection with the exact outer aggregation; do not mix FACTS and METRICS selectors |
| Missing relationship but suitable row-level keys and facts are exposed | Consider a same-table SV projection joined to physical dimensions, preserving join type, key multiplicity and filtering scope |
| Required field/role or semantics cannot be represented safely | Use physical SQL for that portion or the whole answer, recording the concrete gap |

Missing a named metric or relationship does not alone prove every hybrid path impossible. Conversely, wrapping physical work in an SV adds no value unless it reuses an appropriate definition. When coverage is sufficient and SV reuse is requested, try that path; outer aliases, ORDER BY and LIMIT alone are not reasons to abandon it. Do not repeat an unchanged failed query or consume the entire budget exploring unsupported paths.

For multiple paths to one dimension, inspect metric `using_relationships` and [multiple-path guidance](../patterns/snippets/multi_path_metrics.md). Selecting a purchase address, current address or shipment address is a business decision, not an interchangeable join. If a read-only model lacks the needed role binding, use a justified projection/physical fallback instead of editing it.

## Preserve predicate and output meaning

- A filter on business identifiers selected from matching entity versions can include more rows than a filter on the attribute of each joined version. Preserve set membership versus current-row filtering unless uniqueness and equivalence are established.
- Preserve AND/OR grouping, EXISTS versus multiplicative joins, NULL tests versus record presence, and the point at which filtering occurs relative to aggregation or windows.
- Preserve requested columns, aliases, duplicates, order and result extent. A preview limit or CLI default is not permission to add LIMIT to the saved SQL. Use `cz-cli sql --file QUERY --limit 0 --no-truncate --with-schema --timeout 60 --profile PROFILE` when validating the exact query without automatic row-limit rewriting; retain any LIMIT the question actually requires.
- If bounded and unbounded window/ROLLUP queries disagree beyond truncation, use [diagnostics](../patterns/snippets/sv_diagnostics.md) and preserve both SQL texts and job results. Do not repair the model merely because a physical SQL rewrite has the same engine symptom.

## CLI composition details

Use logical table-qualified predicates inside `SEMANTIC_VIEW(... WHERE ...)` to filter source rows before aggregation. An outer WHERE can reference only projected output columns and filters after that aggregation. Do not move a predicate between these levels unless equivalent. Output display suffixes such as `gmt_offset_2` are not guaranteed SQL identifiers. When two roles expose the same output name, select/filter each role in its own subquery or use distinct model names; do not guess a suffix.

FACTS selectors and any DIMENSIONS in the same projection must belong to one logical table. A missing named aggregate may be recoverable through same-table facts, but only if that projection exposes the required keys. For ratios with different filtering scopes, independently compute the numerator and denominator in SV subqueries and combine at the intended grain. For ROLLUP/GROUPING/RANK, consider outer SQL over compatible SV aggregates; do not sum ratios or averages across groups without their weights.

`sv query --dimensions` accepts separate array values (or repeated flags), not one comma-joined value. `--filters` selects named model filters; `--where` supplies an SQL predicate. Check the selected version's help when an option is rejected. An argument error before submission is not evidence that the server rejects SV SQL. Native SQL through `cz-cli sql` remains an available execution path.

```bash
cz-cli sv query WORKSPACE.SCHEMA.VIEW \
  --dimensions orders.region orders.month \
  --metrics orders.revenue --where 'orders.year = 2025' \
  --execute --timeout 60 --profile PROFILE
```

Replace the example fields with observed model fields. With native `SEMANTIC_VIEW(...)`, selectors use logical table-qualified names; the outer SELECT uses the actual exposed output names. Explicitly qualify physical objects or preserve the source schema in the execution command so the saved query can be reproduced.

Execute the final saved SQL in that context. EXPLAIN, a failed validation job or a job ID without a successful result is not successful execution. Compare result columns and extent with the question; use an independent physical comparison when a non-obvious semantic rewrite needs validation. Report actual SV use separately from attempted-but-failed use and model inspection. Record unresolved assumptions instead of asserting equivalence from an empty result alone.

For an answer that already succeeded through SV, keep that successful SQL as an artifact even if the final answer chooses another equivalent query. Do not silently replace working SV SQL with a newly generated unexecuted variant. The final report should distinguish metadata inspection, successful SV partial calculations, complete SV/hybrid answers, and justified physical fallback.
