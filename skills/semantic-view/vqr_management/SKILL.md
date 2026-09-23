---
name: cz-semantic-view-vqr-management
description: "Add, remove, expand, truncate, or spot-validate verified queries. Use for individual SQL examples or physical/semantic conversion; use validate for whole-model and bulk VQR health checks."
metadata:
  parent-skill: cz-semantic-view
---

# Manage verified queries

VQRs pair a business question with executable readonly SQL. Preserve provenance and business intent when editing or converting them. Use the selected connection profile for remote reads, compilation, or result comparison.

## Phase 1: obtain the model

Use an existing local file directly, or download the remote view and its baseline:

```bash
cz-cli sv read analytics.public.sales --out-path /tmp/sales.sv.yaml --profile PROFILE
```

Keep `.manifest.json` alongside the local model. Prefer JSON request files and `--operations-file` over large inline shell arguments. Backend responses store a JSON string in `data.result`; parse both layers when saving structured evidence. Do not confuse a truncated terminal preview with a complete model export.

## Phase 2: select the action

| Intent | Action |
|---|---|
| Add/remove examples | `sv edit` with VQR operations |
| Expand semantic SELECT to physical SQL | backend `expand_verified_query` |
| Convert physical SELECT to semantic SQL | backend `truncate_verified_query` |
| Check selected SQL strings | backend `validate_verified_queries` with `sqls` |
| Check all stored queries | [validate](../validate/SKILL.md), `--mode queries` |

## Phase 3: local CRUD

Save operations to `/tmp/vqr-operations.json`, then run:

```bash
cz-cli sv edit --file-path /tmp/sales.sv.yaml --operations-file /tmp/vqr-operations.json
```

```json
[{"operation":"add_vqr","params":{"name":"revenue_by_region","question":"What is revenue by region?","sql":"SELECT * FROM SEMANTIC_VIEW(analytics.public.sales DIMENSIONS o.region METRICS o.revenue)","use_as_onboarding_question":true}}]
```

| Operation | Parameters |
|---|---|
| `add_vqr` | Required `name`, `question`, `sql`; optional `verified_at`, `verified_by`, description and onboarding flag |
| `remove_vqr` | Explicit `name` |
| `remove_vqrs` | Explicit `names` array; enumerate all names only when clearing is requested |

Names are stable identifiers; do not delete by guessing from a question. The current adapter rejects duplicate names, but it does not automatically deduplicate questions or normalize physical SQL into logical SQL. Check semantic duplicates before adding. Use epoch seconds for verification timestamps intended for native round trips and record who/what actually checked the query. Local edits do not prove SQL validity or alter the remote object.

## Phase 4: batch conversion or spot validation

Backend accepts inline `semantic_model` (YAML string or model object), `yaml_content`, `semantic_view` FQN, or local `file_path`. Use only the intended model source. When supplying local/inline YAML for truncation, also provide `--fqn` for the existing target; `semantic_view` supplies the target automatically. Save a request like this to `/tmp/vqr-request.json`:

```json
{"tool":"validate_verified_queries","parameters":{"semantic_view":"analytics.public.sales","sqls":["SELECT * FROM SEMANTIC_VIEW(analytics.public.sales METRICS o.revenue)","SELECT SUM(amount) FROM analytics.public.orders"]}}
```

```bash
cz-cli sv backend --file-path /tmp/vqr-request.json --profile PROFILE > /tmp/vqr-response.json
```

Change the tool to `expand_verified_query` or `truncate_verified_query` for conversion. These tools accept `sqls` arrays; legacy single `sql`/`query` remains supported. Supply at least one SQL for conversion. Batch results preserve input order and `input_sql`, return per-item success/error and an overall success flag. A malformed input or any input write is rejected before conversion begins. One conversion/compilation error does not erase the other items' evidence.

For validation, `results` contains question (null for inline SQL), SQL, validity, error or job ID. The legacy `queries` field is retained. An empty validation array checks zero queries; it is not an accuracy result.

### Compatibility boundary

Conversion is performed by the configured LLM, followed by EXPLAIN of original and transformed SQL. It is not a deterministic compiler expansion. Both SQL forms must resolve against the current server objects; undeployed logical aliases are not automatically expanded during validation. Omitting `verified_queries` from a temporary conversion copy can avoid feeding unrelated examples, but never remove them from the saved model as a side effect.

Inspect transformed SQL for grain, filters, relationship roles, NULL treatment, measures, and the correct target FQN. Without `--evaluate`, conversion reports `equivalence_verified:false`. With `--evaluate`, the CLI compares full bounded result multisets on current data (up to 10,000 rows); truncation fails evaluation. This comparison excludes row order and is not a universal equivalence proof. A non-equivalent conversion is a rejected candidate even if it compiles.

## Phase 5: deploy and report

Deploy selected local changes only within the user's authorized target and scope, using [upload](../upload/SKILL.md). Preserve the baseline and perform readback. The deployment path also checks VQR compilation; a post-create query failure can leave a partial deployment/recovery journal. Keep that evidence and repair explicitly.

Report added/removed names, original and transformed SQL, validation/comparison status, assumptions, and local/remote state. Requests to suggest examples route to [VQR suggestions](../vqr_suggestions/SKILL.md); a suggested or compilable query is not automatically business-verified.
