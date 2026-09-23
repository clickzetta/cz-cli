---
name: cz-semantic-view-validate
description: "Validate semantic-view YAML, deployment readiness, or stored verified queries. Separate model checks from explicitly requested VQR compilation; route individual query edits to VQR management."
metadata:
  parent-skill: cz-semantic-view
---

# Validate a semantic view

Choose the check that answers the user's request. A valid YAML model, an accepted DDL plan, a compilable query, and a business-correct result are different outcomes.

If the user needs an analysis answer from existing views, use the [querying guide](../reference/querying_existing_views.md); select the checks below only as needed for that answer. Bulk model/VQR validation is not a substitute for composing and executing the requested query.

| Request | Check |
|---|---|
| Check YAML shape or references | `sv validate --mode local` |
| Check whether this definition can deploy | `--mode remote` with target and profile |
| Check stored VQRs / broken example SQL | `--mode queries` |
| Check definition and VQRs | `--mode all` |
| Check or transform a few SQL strings | [VQR management](../vqr_management/SKILL.md) |
| Evaluate modeling quality or source keys | [audit](../audit/SKILL.md) |

Do not automatically run bulk VQR checks for a YAML-only request. A request to implement and verify an end-to-end model already includes relevant query validation; do not ask for the same authorization again. Standalone validation does not edit files or deploy anything.

## Resolve input

Use a local `.sv.yaml` when given. For a remote view, resolve its fully qualified name and read it with the selected profile:

```bash
cz-cli sv read analytics.public.sales --out-path /tmp/sales.sv.yaml --profile PROFILE
```

Retain the returned remote fingerprint, managed metadata status, and unmapped fields. A successful read is not proof that a stale managed model matches the server definition. Relative files resolve under `cz_project/`; use absolute paths for saved evidence.

## Validate model definition

```bash
cz-cli sv validate --file-path /tmp/sales.sv.yaml --mode local
cz-cli sv validate --file-path /tmp/sales.sv.yaml --fqn analytics.public.sales --mode remote --profile PROFILE
```

Local checks cover strict fields, duplicate names, logical references, relationship endpoints, cycles, and non-additive dimension references. Remote validation compiles the model and runs `EXPLAIN CREATE/OR REPLACE SEMANTIC VIEW`; it does not create the view. The target workspace/schema and actual source permissions matter. Report local and remote outcomes separately, including generated error codes and plan job ID.

If the target does not exist, an EXPLAIN plan can still establish definition readiness where the engine permits it; it does not make the candidate available to subsequent SELECTs. Range relationships and computed relationship keys are rejected by the current compiler; see [diagnostics](../patterns/snippets/sv_diagnostics.md).

## Validate stored queries

```bash
cz-cli sv validate --file-path /tmp/sales.sv.yaml --mode queries --profile PROFILE
cz-cli sv validate --file-path /tmp/sales.sv.yaml --fqn analytics.public.sales --mode all --profile PROFILE
```

The current adapter checks each stored SQL with a readonly guard and `EXPLAIN`. It does **not** expand logical `FROM orders` references from an undeployed YAML into physical SQL. VQRs must already be executable physical SELECTs or native `SEMANTIC_VIEW(...)` SELECTs against existing server objects. A physical table with the same name as a logical alias can accidentally compile; verify the intended binding explicitly.

For each failure show name/question, SQL, stage and error; for passes retain the query job ID. Summarize passed/failed counts. If the model has no VQRs, report "no queries to validate", not "business behavior verified". An undeployed candidate with semantic VQRs may require validation after creation; describe that pending stage rather than treating missing target errors as incorrect business logic.

## After validation

Route structural errors to [edit](../edit/SKILL.md), VQR-only errors to [VQR management](../vqr_management/SKILL.md), and suspicious totals to data/semantic diagnostics. EXPLAIN does not verify totals, grain, NULL behavior, fanout, date roles, or sorting. Where business validation is requested, compare representative results with independently grounded SQL and record unresolved assumptions.

Return the input identity, requested validation scope, checks actually run, job IDs/errors, and remaining checks. Never set VQR verification metadata merely because SQL compiles.
