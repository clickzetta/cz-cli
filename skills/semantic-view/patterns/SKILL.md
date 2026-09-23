---
name: cz-semantic-view-patterns
description: "Select, adapt, and validate ClickZetta semantic-view patterns for time, relationships, metrics, windows, snapshots, and metadata."
metadata:
  parent-skill: cz-semantic-view
---

# Semantic-view pattern catalog

Use this catalog after the base model has been read and the business question has been reduced to a grain, entities, relationships, and measures. Read only the matching snippet, then validate the resulting model locally and with the target ClickZetta profile. A snippet is an authoring aid, not evidence that every SQL shape is supported by the installed engine.

Before choosing a pattern:

1. Run `cz-cli sv capabilities` and record the installed CLI compiler features. This command reports local capabilities, not live engine discovery.
2. Confirm physical source columns and join keys with read-only `DESC TABLE` / profiling SQL through `cz-cli sql`.
3. Compile the smallest model that demonstrates the pattern; inspect the generated DDL and query plan.
4. Run a small read-only query before adding more metrics or metadata. Deploy only when the user has authorized the target and the command uses `sv deploy --write`.

| Business shape | Read | Verified ClickZetta boundary |
|---|---|---|
| Calendar, fiscal, or period analysis | [time intelligence](snippets/time_intelligence.md) | Prefer physical aligned date keys and declared time dimensions. Computed foreign-key relationships are rejected by the compiler. |
| Latest applicable historical row | [ASOF join](snippets/asof_join.md) | Equality keys plus one right-side time boundary are supported when source types and ordering are valid. |
| Interval or band containment | [range join](snippets/range_join.md) | Native range relationships are intentionally blocked with `RANGE_UNSUPPORTED`; use a prepared bridge/bucket table or an explicit physical query. |
| Balance or inventory at a time boundary | [semi-additive metric](snippets/semi_additive_metric.md) | Declare the time boundary and `NON ADDITIVE BY`; do not sum a snapshot across time without an explicit business rule. |
| Ranking, running totals, or period comparison | [window metrics](snippets/window_metrics.md) | Window expressions run over the aggregate semantic result at the requested dimensional grain. Validate generated SQL and ordering. |
| One source with several foreign keys to one dimension | [multiple relationship paths](snippets/multi_path_metrics.md) | Use named relationship roles and equal-key joins. Range-based path selection remains unsupported. |
| One process row with several milestones | [accumulating snapshots](snippets/accumulating_snapshot.md) | Model each milestone as a declared date/time dimension; do not infer process state from undocumented SQL. |
| One physical dimension used in several business roles | [role-playing dimensions](snippets/role_playing_dimensions.md) | Use logical aliases backed by the same physical source and verify every role's join path. |
| Margin, conversion, or other ratio | [derived metrics](snippets/derived_metrics.md) | Reference declared aggregate metrics; keep `NULLIF`/zero-denominator behavior explicit. Flatten scalar chains when compiler diagnostics require it. |
| Reusable entity-grain fact | [entity facts](snippets/entity_facts.md) | Entity-grain aggregate facts work in the tested fixture; a CASE dimension over such a fact was rejected remotely. Use outer classification or a prepared entity-grain source. |
| Two or more independent fact tables | [multiple fact tables](snippets/multi_fact_table.md) | Aggregate each fact at its own compatible dimensional grain before combining. Never invent a raw fact-to-fact join. |
| Fact-derived relationship key | [computed relationship keys](snippets/fact_as_relationship_key.md) | Computed relationship keys are rejected with `COMPUTED_KEY_UNSUPPORTED`; materialize the key or use a physical query. |
| Business vocabulary and example questions | [AI metadata](snippets/ai_metadata.md) | Descriptions, synonyms, samples, filters, and verified queries are managed metadata. They guide generation but do not repair an invalid model. |
| Compiler, query, data, or metadata failure | [semantic diagnostics](snippets/sv_diagnostics.md) | Diagnose the failing layer first; do not hide a deployment or readback error behind a physical-SQL fallback. |

## Selection and reporting rules

- Preserve the business intent and name the chosen pattern in the model's metadata or design note.
- Treat `range_join` and `fact_as_relationship_key` examples as non-deployable intent unless the capability check proves a newer engine supports them; keep the expected error code in validation output.
- If two patterns compete, build two minimal drafts and compare compiled SQL, join grain, and readback results. Choose the one with the smallest unexplained physical assumption.
- When a pattern cannot be represented natively, report the exact unsupported shape, the materialized/preprocessed alternative, and the query semantics that must be tested after migration.
- Route errors to [semantic diagnostics](snippets/sv_diagnostics.md), then return to the selected pattern. Do not silently switch to a different grain.

Every completed pattern report should include: source tables and keys, logical grain, selected snippet, capability result, generated DDL/query evidence, readback result, and any unsupported boundary.
