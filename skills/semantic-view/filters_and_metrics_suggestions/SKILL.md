---
name: cz-semantic-view-filters-and-metrics-suggestions
description: "Suggest reusable metrics, named filters, and facts from supplied query history and model definitions; explain evidence, select changes, and validate their grain and business meaning."
metadata:
  parent-skill: cz-semantic-view
---

# Suggest filters, metrics, and facts

Extract expressions people actually use, preserving the model's business grain. The output is a set of proposed edits, not an automatic deployment or a verified business definition.

## Phase 1: gather context

Resolve the local model or download a remote view with `sv read FQN --out-path /tmp/model.sv.yaml --profile PROFILE`. Gather the history scope and provenance. `--history-file` supplies evidence to the LLM; there is no implicit account-history mining. If history is unavailable, clearly label model-only proposals and leave frequency unknown.

Inspect existing definitions first. Similar names need not mean the same business formula, and differently named expressions may duplicate an existing metric. Keep original query IDs and SQL so suggestions can be traced back.

## Phase 2: generate and classify

```bash
cz-cli sv suggest --kind filters_and_metrics_suggestions --file-path /tmp/model.sv.yaml --history-file /tmp/history.json --out-path /tmp/field-suggestions.json
```

Read the full saved `suggestions[].reason`, `operations`, and warnings. The compatibility backend returns JSON text in `data.result`; its operations use ClickZetta edit parameter objects, not remote path/value patch objects.

| Candidate | Example | Review question |
|---|---|---|
| Metric | `SUM(o.amount)`, `COUNT(DISTINCT o.customer_id)` | What is the grain, unit, denominator, and treatment of NULL/returns? |
| Named filter | A reusable customer status predicate | Does it act before aggregation, and which physical/logical fields supply it? |
| Scalar fact | `CASE WHEN resolution_days <= 2 THEN 1 ELSE 0 END` | Is this row-level, and is the threshold an actual business rule? |
| Derived metric | Margin divided by revenue | Are numerator/denominator declared at compatible grains, and is zero handled? |
| Key proposal | A candidate primary/composite key | Is uniqueness/non-nullness supported by source declarations or a data audit? |

Do not turn an aggregate into a row fact or sum snapshot balances across time by default. Route non-additive, relationship-role, or window requirements to the matching [pattern](../patterns/SKILL.md).

## Phase 3: present selected recommendations

Group results into metrics, filters, facts, and key proposals. For each show the target table/field, expression, description, source queries, observed frequency or unknown, existing equivalent definitions, and assumptions. Explain recommendations using recurrence and reusable business coverage. Preserve lower-priority suggestions with their reason when reporting the full requested set.

A one-person/date predicate may be useful in a VQR but not as a permanent named filter. A repeated formula may deserve one reusable metric rather than many question-specific metrics. Do not fabricate frequency from an LLM explanation; verify it against supplied records.

## Phase 4: apply and test

For authorized enrichment, save selected operations and apply them using [edit](../edit/SKILL.md). For suggestions only, return the candidates without changing the model. Validate local references, remote compilation and affected business queries; use the same source SQL to check that extraction preserved meaning.

Named filters are managed metadata consumed by `sv query --filters`; physical-column predicates receive declared `__cz_filter_*` support facts. These are public query conveniences, not row-level security or native FILTERS DDL. Other clients do not automatically apply them. Explain this when it affects the user's intended behavior.

Keep proposed/applied/deployed states distinct. Empty results can mean insufficient supplied history or no new expressions; a provider error is not "no useful metrics". Report remaining gaps and route VQR candidates to [VQR suggestions](../vqr_suggestions/SKILL.md).
