---
name: cz-semantic-view
description: "Create, edit, deploy, validate and maintain ClickZetta semantic views or semantic YAML. Route modeling, descriptions, audits, relationship/metric/VQR suggestions, verified-query management, optimization and OSI imports to their workflows; query existing views when requested."
metadata:
  parent-skill: cz-agent-studio
---

# ClickZetta Semantic Views

Use the selected connection profile on remote commands (`--profile NAME`). Relative model paths resolve under `cz_project/`; absolute paths are accepted. Read `cz-cli sv capabilities` for the current schema and supported operations. Local output is a model draft; deployment requires `sv deploy --write`. An existing user request to implement/deploy supplies authorization within its scope; do not invent another approval gate.

Choose a workflow from the user's intended result:

“Create/build/set up a semantic view,” “create a semantic model,” and “model this schema” route directly to creation. Do not ask the user to select a workflow when the intent is already clear. Load the selected sub-skill before performing its operations. Description tasks additionally load [description guidelines](reference/description_guidelines.md).

| Work | Skill |
|---|---|
| New model from tables/SQL | [creation](creation/SKILL.md) |
| Answer an analysis question using an existing view | [Querying guide](reference/querying_existing_views.md) |
| Download/read existing definition | [download](download/SKILL.md) |
| Structured local changes | [edit](edit/SKILL.md) |
| Upload/deploy and recover | [upload](upload/SKILL.md) |
| Definition and query checks | [validate](validate/SKILL.md) |
| Descriptions | [generate_description](generate_description/SKILL.md) |
| Relationships | [suggest_relationships](suggest_relationships/SKILL.md) |
| Metrics and named filters | [filters_and_metrics_suggestions](filters_and_metrics_suggestions/SKILL.md) |
| VQR discovery and maintenance | [vqr_suggestions](vqr_suggestions/SKILL.md), [vqr_management](vqr_management/SKILL.md) |
| Quality and custom criteria | [audit](audit/SKILL.md) |
| Iterative improvement | [agentic_optimization](agentic_optimization/SKILL.md) |
| OSI semantic-model conversion | [import_osi](import_osi/SKILL.md) |
| Advanced modeling | [patterns](patterns/SKILL.md) |

## Resolve similar intents

- A specific change such as “add metric X” or “rename Y” belongs to edit. A request for ideas such as “what metrics should I add?” belongs to metrics/filter suggestions.
- Finding candidate example questions belongs to VQR suggestions. Adding/removing a known example, expanding/truncating its SQL or validating a selected query belongs to VQR management.
- Definition validation before deployment belongs to validate. Only run a separate bulk VQR review when requested or needed for the authorized delivery; deployment's built-in VQR compilation check still applies.
- For an analysis answer, read the querying guide before choosing SQL. Definition/VQR validation alone does not answer the question; discovery, query composition and result execution belong to this query workflow.
- Starting, checking, resuming or cancelling an optimization job belongs to agentic optimization. A single known model correction does not require an optimization job.
- A request to build a model does not by itself request a separate analysis answer. Generate model validation queries within the authorized task; do not start unrelated analyses.
- If the intent is genuinely unclear, offer the relevant choices (create, edit, deploy, export, descriptions, audit, validate, suggestions, VQR maintenance, optimize or import) rather than loading every workflow.

## Recognize advanced modeling intents

Load [patterns](patterns/SKILL.md) for these requests or symptoms, then read only the relevant reference:

| Intent or symptom | Reference |
|---|---|
| Same period last year/month, YoY/MoM, reporting calendar | [Time intelligence](patterns/snippets/time_intelligence.md) |
| Rolling averages, cumulative YTD/QTD/MTD, lag or ranked aggregates | [Window metrics](patterns/snippets/window_metrics.md) |
| Event-time lookup, latest effective record, SCD2/ASOF | [ASOF](patterns/snippets/asof_join.md); check whether an upper validity bound is also needed |
| Balance, inventory or headcount that must not sum across time | [Semi-additive metrics](patterns/snippets/semi_additive_metric.md) |
| Process stages with multiple milestone dates | [Accumulating snapshots](patterns/snippets/accumulating_snapshot.md) |
| Two foreign keys to the same entity; select a business join path | [Multiple paths](patterns/snippets/multi_path_metrics.md) |
| One physical dimension serving different business roles | [Role-playing dimensions](patterns/snippets/role_playing_dimensions.md) |
| Cross-entity totals, net amounts, ratios or percent of total | [Derived metrics](patterns/snippets/derived_metrics.md) |
| Independent facts with shared dimensions | [Multiple fact tables](patterns/snippets/multi_fact_table.md) |
| Private aggregate fact used to define a segment or calculated dimension | [Entity facts](patterns/snippets/entity_facts.md) |
| Computed, non-physical relationship key | [Computed relationship keys](patterns/snippets/fact_as_relationship_key.md) |
| Relationship by a value range | [Range joins](patterns/snippets/range_join.md) |
| Model instructions, samples, synonyms and query-generation guidance | [AI metadata](patterns/snippets/ai_metadata.md) |
| Ambiguous paths, unexpected totals, grain/cardinality errors | [Diagnostics](patterns/snippets/sv_diagnostics.md) |

Pattern presence is not proof of native support. Use `sv capabilities` and the connected engine checks; blocked range/computed-key shapes need an explicit supported alternative, not invented DDL.

## File and import routing

Use the user's actual model filename, not a guessed filename derived from the view name. Prefer `sv read` for tracked exports and `sv edit` for modifying an existing model. Extract generated response YAML with a parser; large model content belongs in files, not shell arguments. Preserve the manifest and deployment journal.

Open Semantic Interchange/OSI YAML routes to its import skill. Tableau and Power BI conversion are deliberately out of the current CZ release scope; do not route those files to an SV importer. Ordinary SV YAML is not an OSI import.

## Command contract

`sv` owns semantic-model operations; existing `studio` functionality is independent. Do not use an invented `agent-studio sv-*` command.

```bash
cz-cli sv read WORKSPACE.SCHEMA.VIEW --out-path /tmp/view.sv.yaml --profile PROFILE
cz-cli sv query WORKSPACE.SCHEMA.VIEW --metrics orders.revenue --execute --profile PROFILE
cz-cli sv query WORKSPACE.SCHEMA.VIEW --question 'Revenue by region?' --profile PROFILE
```

Natural-language generation uses the configured CLI LLM. The response includes generated SQL and its EXPLAIN job, and executes data only with `--execute`. Deterministic queries accept `--dimensions`, `--metrics`, `--facts`, `--filters`, `--where`, `--limit`; facts and aggregate metrics cannot be mixed.

CLI JSON output is wrapped in `data`. `sv backend` additionally keeps the compatibility contract `data.result`, a JSON string. `sv generate --out-path` saves an unwrapped generation object containing `json_proto.semanticYaml`; `sv read --out-path` saves YAML. Do not feed the JSON envelope to the YAML parser.

## Persistence and fidelity

Native fields are verified using JSON `DESC SEMANTIC VIEW EXTENDED`; SHOW CREATE is not a lossless export. CLI-only authoring fields are stored in `cz.sv.authoring.v1` with a native fingerprint: named filters, data types, samples, false traits, module instructions and import provenance. Stale managed metadata or unknown server fields block replacement until reconciled. Never silently discard them.

`plan` validates DDL without applying it. `deploy` does CREATE/OR REPLACE, restores properties, checks native readback, validates VQR compilation, saves managed metadata and verifies again. It is a multi-step operation, not a server transaction; the journal supports property/metadata recovery. A fingerprint prevents observed conflicts but is not distributed compare-and-swap.
