---
name: cz-semantic-view-suggest-relationships
description: "Find missing joins or foreign-key relationships from model metadata and supplied query evidence; validate keys, role paths and cardinality before applying selected relationships."
metadata:
  parent-skill: cz-semantic-view
---

# Suggest missing relationships

Use this workflow when the model has disconnected tables, incomplete foreign keys, or ambiguous business-role paths. Similar column names alone do not establish a valid join.

## Phase 1: read the model and evidence

Use an existing workspace file, or download the remote definition:

```bash
cz-cli sv read analytics.public.sales --out-path /tmp/sales.sv.yaml --profile PROFILE
```

Keep the baseline/manifest. Inspect physical column types, declared keys, existing relationships and metrics with `using_relationships`. Supplied historical SQL and question/SQL pairs can identify joins actually used, including composite keys and business roles. They do not by themselves prove one-to-one or many-to-one cardinality.

## Phase 2: generate candidates

```bash
cz-cli sv suggest --kind suggest_relationships --file-path /tmp/sales.sv.yaml --history-file /tmp/history.json --out-path /tmp/relationships.json
```

The current adapter uses the configured LLM for suggestions, even without history. It does not provide a separate deterministic metadata-only inference engine. Do not claim that `use_llm_relationships:false` or a source-platform `model_name` selects such a mode; provider selection uses the actual CLI `--llm`/`--model` options.

For backend usage, pass the model file and evidence such as `questions:[{question,sql}]` in parameters. Read the returned JSON string from `data.result`; high-level `sv suggest` saves `suggestions` with reasons and edit operations.

## Phase 3: review the candidate joins

Report name, left/right logical tables, paired key columns in order, join/relationship type, business role, evidence and pending checks. Check:

- compatible source types and key values, including composite-key ordering;
- duplicate and NULL keys on the proposed unique side, using declarations or an appropriate data audit;
- unmatched foreign keys and intended retention of facts;
- duplicate existing joins and multiple roles such as purchase date versus shipment date;
- changed aggregate grain or fanout across facts;
- temporal evidence when ASOF is proposed, and unsupported range/computed-key shapes.

Use [patterns](../patterns/SKILL.md) for role-playing, multiple paths, ASOF or multi-fact modeling. Never label a many-to-many join many-to-one merely to pass the compiler. If uniqueness is unverified, say so and keep it pending.

## Phase 4: apply the selected relationships

Use structured `add_relationship` edits; do not overwrite the whole model with an LLM-returned YAML and bypass dependent-reference checks.

```json
[{"operation":"add_relationship","params":{"name":"orders_to_customers","left_table":"orders","right_table":"customers","left_columns":["customer_id"],"right_columns":["id"],"join_type":"left","relationship_type":"many_to_one"}}]
```

```bash
cz-cli sv edit --file-path /tmp/sales.sv.yaml --operations-file /tmp/relationship-operations.json
cz-cli sv validate --file-path /tmp/sales.sv.yaml --mode local
```

A request to enrich the model permits justified local changes within scope; a suggestions-only request returns the candidate table for selection. Deploy only within the authorized target via [upload](../upload/SKILL.md), then compare representative aggregate results and read back the relationships. Local schema validity alone does not establish join correctness.

Report candidates, accepted/rejected reasons, key evidence, changes applied, validation results and unresolved joins. If metadata or permission errors prevented inspection, preserve that distinction from "no missing relationships".
