---
name: cz-semantic-view-generate-description
description: "Generate or improve semantic view, table and field descriptions. Use for documenting a model, explaining a component, or adding grounded descriptions and synonyms."
metadata:
  parent-skill: cz-semantic-view
---

# Generate Semantic View Descriptions

## First step: load guidelines

Read [description guidelines](../reference/description_guidelines.md) before generating descriptions. Use the component-specific rules and examples; do not copy unsupported business assumptions from an example.

## Tools and context

Use the selected profile for remote operations. Relative model paths resolve under `cz_project/`; absolute paths avoid ambiguity. Use `sv read` to inspect and `sv edit` to apply descriptions. Preserve existing user authorization: an explicit request to improve and apply descriptions does not require a second approval for each field. A request for suggestions alone does not authorize deployment.

## Phase 1: Identify target components

Read the current model:

```bash
cz-cli sv read --fqn WORKSPACE.SCHEMA.VIEW --out-path /tmp/model.sv.yaml --profile PROFILE
```

For an existing local model:

```bash
cz-cli sv read --source workspace --file-path /tmp/model.sv.yaml
```

Inventory the view, tables and columns with their current description status. Use the scope already specified, such as all tables or one metric. If the request leaves materially different scopes possible, resolve that ambiguity before applying edits. Preserve useful existing definitions.

## Phase 2: Generate descriptions

For each component, inspect its definition, supplied business context and available verified queries:

| Component | Analyze | Include |
|---|---|---|
| View (usually 3–6 sentences) | Table domains and relationships, VQR questions, recurring use cases, user goals | Domain, purpose, grain context, scope and known exclusions |
| Table (usually 2–4 sentences) | Columns, source, keys, relationship roles and query usage | Business entity, explicit row grain, analytical role, useful relationship context |
| Metric/measure (usually 1–3 sentences) | Aggregate expression, denominator, units and query usage | Meaning, plain-language calculation, aggregation behavior, known units and caveats |
| Dimension | Expression, data type, grouping/filtering use, observed values | Classification, supported values and business purpose |
| Time dimension | Timestamp source and role | Event meaning, relevant verified timezone and reporting purpose |
| Filter | Predicate and its scope | What it includes/excludes and business purpose |
| Relationship/identifier | Join roles, key evidence and cardinality | Business relationship or entity identity; distinguish declared from verified uniqueness |

Avoid SQL syntax, physical schema references, pipeline details and vague descriptions in business prose. Do not invent currency, timezone, certification, access controls or uniqueness. Missing VQRs reduce available context but do not prevent describing facts supported elsewhere.

An optional candidate generator is available:

```bash
cz-cli sv suggest --kind generate_descriptions --file-path /tmp/model.sv.yaml --history-file /tmp/history.json --out-path /tmp/suggestions.json
```

Omit the history file if none is supplied. This separate LLM call returns candidate operations; it does not automatically read this skill or its guidelines. Review every selected candidate against the loaded guidelines and evidence before applying it. Generation is not business verification.

## Phase 3: Present or review suggestions

For one component, show its type/name, proposed description, reasoning, relevant evidence and useful synonyms. For multiple components, use a table with those fields. Distinguish inferred meaning and unresolved questions.

If the user requested a review before application, offer accept, modify, regenerate or skip and wait for selection. If application is already authorized, review candidates against the supplied scope and continue; ask only when missing business information prevents choosing the correct meaning.

## Phase 4: Apply descriptions

Save the selected structured operations to a JSON file:

```json
[
  {"operation":"update_column_description","params":{"table":"orders","column":"amount","description":"Order amount before refunds, in the currency recorded on each order."}},
  {"operation":"update_table_description","params":{"table":"orders","description":"Represents sales order lines. Each row identifies one product line within an order."}}
]
```

These are illustrative definitions: substitute facts supported by the actual model.

```bash
cz-cli sv edit --file-path /tmp/model.sv.yaml --operations-file /tmp/descriptions.json
cz-cli sv validate --file-path /tmp/model.sv.yaml --mode local
```

Read back changed components and verify only intended descriptions/synonyms changed. Follow [edit](../edit/SKILL.md) for editing details and [upload](../upload/SKILL.md) when deployment is in scope. A local edit is not a deployed change.

## Completion and errors

- Guidelines loaded; target components identified; descriptions follow component-specific rules and evidence.
- Selected changes applied through structured edits when authorized, with locations and local/remote state reported.
- YAML parse failure: fix model syntax before changing descriptions.
- Missing component: inspect available component names rather than creating a guessed field.
- Generic description: identify missing context and revise; do not increase length merely to improve a score.
- Missing VQRs or business facts: state the limitation; do not fabricate supporting examples.
