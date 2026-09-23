---
name: cz-semantic-view-edit
description: "Apply structured atomic edits to ClickZetta model tables, fields, relationships, instructions and verified queries."
metadata:
  parent-skill: cz-semantic-view
---

# Edit a Semantic View

Use the selected connection profile on remote commands (`--profile NAME`). Relative model paths resolve under `cz_project/`; absolute paths are accepted. Read `cz-cli sv capabilities` for the current schema and supported operations. Local output is a model draft; deployment requires `sv deploy --write`. An existing user request to implement/deploy supplies authorization within its scope; do not invent another approval gate.

## Phase 1: retrieve and inspect

Use an existing local file when supplied. Otherwise resolve the view using the selected profile and `sv list`/`sv search`, then download with `sv read FQN --out-path /tmp/sales.sv.yaml`. Keep the `.manifest.json` remote baseline. Do not overwrite unrelated local edits merely to refresh the remote copy.

Summarize tables, dimensions/facts/metrics/filters, relationships, VQRs, custom instructions, and requested changes. Readback with stale managed metadata or unmapped fields needs reconciliation before replacement. Use the actual source columns from read-only `DESC TABLE`; a logical label does not prove a physical column exists.

## Phase 2: choose scope and modeling pattern

Proceed directly when the user specified the edit. For VQR-only operations use [VQR management](../vqr_management/SKILL.md); for model health checks use [validate](../validate/SKILL.md).

If the change involves period comparisons, rolling windows, temporal lookup, inventory/balance snapshots, milestone dates, role-playing dimensions, a chosen relationship path, cross-fact ratios, private intermediates or computed keys, read the matching [pattern](../patterns/SKILL.md) first. Return here to apply the supported primitives. Do not silently replace an unsupported pattern with a change in business grain.

## Phase 3: transactional local edits

Download a remote model first. Put an ordered JSON operation array in a file, then run:

```bash
cz-cli sv edit --file-path /tmp/sales.sv.yaml --operations-file /tmp/operations.json
cz-cli sv validate --file-path /tmp/sales.sv.yaml --mode local
```

All operations apply to a clone, then the final model is validated and atomically renamed into place. A failed operation leaves the original file intact. `--baseline` here means the SHA-256 fingerprint of the original file text. A local exclusive lock prevents concurrent local edits.

| Operations | Required parameters |
|---|---|
| `add_table` | `name`, `base_table:{database?,schema,table}`, optional description |
| `rename_table` | `old_table_name`, `new_table_name` |
| `remove_table` | `table_name`; remove dependents explicitly first |
| `add_dimension`, `add_fact`, `add_metric`, `add_filter` | `table` (optional for top-level metric), `name`, `expression` or `expr`; optional description, data_type, synonyms, access_modifier, using_relationships, non_additive_dimensions |
| `rename_column` | `table`, `old_name`, `new_name` |
| `remove_column`, `remove_dimension`, `remove_fact`, `remove_metric`, `remove_filter` | `table`, `name` or `column`; `handle_dependents:"remove"` explicitly cascades |
| `update_column_expression` | `table`, `column`, `new_expression` |
| `update_column_description` | `table`, `column`, `description` |
| `update_column_synonyms` | `table`, `column`, `synonyms` array |
| `update_column_sample_values` | `table`, `column`, `sample_values` array |
| `update_model_description` | `description` |
| `update_table_description` | `table`, `description` |
| `set_primary_key`, `add_unique_key` | `table`, `columns` array |
| `add_relationship` | `name`, `left_table`, `right_table`, `left_columns`/`right_columns` or `relationship_columns`; optional join_type and relationship_type |
| `rename_relationship` | `old_name`, `new_name` |
| `remove_relationship`, `delete_relationship` | `relationship_name`; explicit cascade if USING metrics depend on it |
| `update_custom_instructions` | `sql_generation` and/or `question_categorization` |
| `add_vqr` | `name`, `question`, `sql`, optional verified_at/verified_by/use_as_onboarding_question |
| `remove_vqr`, `remove_vqrs` | `name` or `names` |

`sv edit --operations '[]'` lists available names. `default_aggregation` on an added measure wraps a scalar expression with sum/avg/min/max/count/count_distinct/median; do not supply it to an already aggregated expression. Reference rewriting respects SQL string literals and quoted identifiers. Rename logical aliases, not physical base-column names. Review dependent VQR SQL after any structural change.

Custom instructions and named filters are managed fields consumed by CLI generation; they are not native DDL clauses. After editing, remote definition validation and VQR compilation still matter. Use the upload skill when deployment is requested.


Prefer an operations JSON file for expressions or descriptions containing quotes/newlines. The local API accepts `{operation, params}` objects, not path/value patches from another backend. Discover operation names with `sv edit --operations '[]'`; `validate_yaml` is not an edit operation in this adapter.

### Common edit sequences

- Prefer `update_column_expression` when correcting a formula while keeping identity. Compare before/after behavior for queries that consume it.
- Rename logical tables or fields through structured operations; generated reference rewrites must not rename physical source columns or words inside string literals. Review VQR references afterward.
- For a kind change, remove and add the field explicitly. `handle_dependents:"remove"` can remove dependent definitions; enumerate affected fields before using it. Recreate selected dependents in the intended order.
- For a relationship-key correction, remove the relationship and add a corrected one; preserve role names used by metrics or update those metrics together. Validate source key uniqueness rather than inferring it from the declared relationship.
- Update instructions with `sql_generation` and/or `question_categorization`; omitted modules remain unchanged. Instructions guide this CLI's generation path and do not enforce database access policies.

## Phase 4: validate the candidate

Use `sv validate --mode local`, then `--mode remote --fqn FQN --profile PROFILE` when checking deployment readiness. Validate the edited file, not merely the old remote definition. Local validation catches structural errors; remote EXPLAIN resolves source tables/columns and engine restrictions. Neither proves source-key uniqueness or correct totals.

Keep field type, SQL expression, unit, NULL/zero behavior and aggregation grain consistent. Read [identifier guidance](../reference/quoted_identifiers.md) when source or logical names need quoting. For a requested complete fix, test affected VQRs or representative questions; a YAML-only check does not imply a bulk VQR request.

## Phase 5: deploy and verify the consuming path

Use [upload](../upload/SKILL.md) for an authorized remote change, preserving the baseline. If the request was local-only, return the local artifact and pending deployment status. After deployment, read back native and managed metadata and test a question that exercises the edit. If another agent/client consumes the view, check that actual client when available; do not claim its behavior changed solely from a DDL success.

Report applied operations, validation/job evidence, deployed target or local path, and unresolved dependencies. On conflict, re-read and reconcile; on partial deployment, retain the recovery journal. Do not replace a concurrent edit or silently call a failed deployment complete.
