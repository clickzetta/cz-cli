---
name: cz-semantic-view-creation
description: "Create a new semantic view or model from physical tables, SQL history and business requirements. Use for create/build/generate requests or modeling an existing schema, not a specific edit to an existing model."
metadata:
  parent-skill: cz-semantic-view
---

# Semantic View Creation

## Phase 1: Gather context

Resolve the following from the request, selected profile and available project material:

| Field | Required context |
|---|---|
| Name | Use the supplied name; otherwise choose a descriptive name when the task authorizes autonomous creation, or resolve a required naming convention |
| Target | Actual workspace/schema and profile; ask if an ambiguous target could affect the wrong objects |
| Sources | Physical tables, supplied SQL, SQL files or code containing SQL |
| Compute | Selected profile/vcluster; do not invent a foreign compute-object parameter |
| Existing file | Honor the exact supplied model path and distinguish new-model creation from editing an existing artifact |
| Business scope | Questions, definitions, grain and intended model boundary supported by available evidence |

Relative paths resolve under `cz_project/`. A file already in that directory can be addressed by its basename; absolute paths avoid accidentally adding the prefix twice. Do not substitute the model name for a user-supplied filename.

SQL history is valuable evidence for definitions, relationships and potential verified-query examples. Do not automatically copy every history item into VQRs. Separate source SQL that actually executed from a newly generated or transformed candidate that still needs validation.

## Phase 1.5: Table intelligence

Once sources are known, inspect supplied/permitted history and available source metadata. Show each source's usage evidence and observation window. For real distinct-query counts over 30 days, use HIGH (50+), MEDIUM (10–49), LOW (1–9), UNUSED/NEW (0), with distinct-user counts when available. A genuinely unused/new source does not prevent modeling when requested.

The current CLI has no equivalent automatic table-activity search in this workflow. Supplied history can establish which sources and computations recur, but a synthetic query count is not a production popularity measure. Missing history is UNKNOWN, not zero. Do not read global history when a task limits you to supplied records or job IDs.

Identify the tables, relationship roles, recurring aggregates and predicates required by the supplied questions. Use this evidence to choose a coherent scope. If a requested source or business requirement is deferred, report that choice; do not silently shrink the task after generation failure.

For a multi-table or history-driven task, keep a compact requirement map beside the model: business computation and grain, relevant source/role, proposed logical fields or relationships, and validation or unresolved status. Group recurring requirements instead of copying every history query. Include fields used only in joins and predicates, not just SELECT outputs. Keep this map when generation fails or the session resumes; reconcile it against the deployed readback before reporting completion. A smaller replacement model must retain explicit unresolved entries.

## Phase 2: Prepare the request

Read the [model-generation contract](../reference/model_generation_contract.md). It is embedded in `sv generate` so the inner model call receives the shared modeling requirements. Include task-specific business definitions and the requirement map in the request; other outer-session context is not automatically forwarded. Review the returned `coverage` against actual model fields and query results: it is an LLM proposal, not a passed test.

Read actual physical metadata through the CLI, for example:

```bash
cz-cli sql 'DESC TABLE `WORKSPACE`.`SCHEMA`.`ORDERS`' --profile PROFILE
```

Use exact returned table/column names. Read [quoted identifiers](../reference/quoted_identifiers.md) for case-sensitive or non-ASCII names. A name resembling a key is not proof of uniqueness.

Before declaring inferred primary/unique keys or a unique relationship endpoint, inspect NULLs and duplicate groups for the exact key tuple through bounded read-only queries. Reuse evidence for the same physical key. A sample without duplicates is inconclusive; if a full check exceeds the budget, leave the assumption unresolved. Versioned entities may have a unique surrogate row key and a repeated business identifier; do not declare both unique or replace one with the other. Check the actual metric/dimension combination for ambiguous role paths, since a standalone total can succeed while a grouped query fails.

Write a JSON request file, with `json_proto` as the outer key:

```json
{
  "json_proto": {
    "name": "sales_model",
    "database": "analytics",
    "schema": "semantic",
    "tables": [
      {
        "database": "raw", "schema": "public", "table": "orders",
        "columnNames": ["order_id", "customer_id", "order_date", "amount"]
      }
    ],
    "sqlSource": {
      "queries": [
        {
          "sqlText": "SELECT customer_id, SUM(amount) FROM raw.public.orders GROUP BY customer_id",
          "correspondingQuestion": "What is the total order amount by customer?"
        }
      ]
    },
    "semanticDescription": "Order analytics at order grain, using supplied business definitions",
    "metadata": {"vcluster": "SELECTED_VCLUSTER"}
  }
}
```

Use actual source columns, definitions and selected connection. `database` is a compatibility spelling for workspace; `columnNames` is an array of strings. Store multi-table requests in a file rather than an inline JSON argument. The CLI fetches DESC metadata again before generation; the model must remain grounded in those sources.

## Phase 3: Generate and save

```bash
cz-cli sv generate --file-path /tmp/sales_proto.json --out-path /tmp/sales_response.json --profile PROFILE
```

Generation can spend time fetching source metadata and waiting for the configured LLM. When the task budget allows, give the shell command 300 seconds so its deadline does not preempt the completion transport's 180-second deadline plus metadata reads. Preserve the request and error; a shell timeout alone does not prove an engine rejection. If a short outer timeout killed the request, one retry with a longer deadline is reasonable; do not keep retrying unchanged failures. Run a bounded diagnostic before launching multiple requests when service latency is uncertain.

The output file is an unwrapped JSON response, not YAML. Extract `json_proto.semanticYaml` with a JSON parser into the intended model file. CLI stdout has a separate `data` envelope; do not confuse the two formats.

```python
import json
from pathlib import Path
response = json.loads(Path('/tmp/sales_response.json').read_text())
Path('/tmp/sales.sv.yaml').write_text(response['json_proto']['semanticYaml'])
```

Use the real chosen filename instead of this example path. For small content, `sv write --yaml-content CONTENT --file-path FILE` provides validated atomic writing; shell substitution still counts toward argv size, so large exports should remain files. Subsequent modifications use structured `sv edit` operations.

```bash
cz-cli sv validate --file-path /tmp/sales.sv.yaml --mode local
cz-cli sv plan --file-path /tmp/sales.sv.yaml --fqn analytics.semantic.sales_model --profile PROFILE
```

Review generated assumptions, source coverage, grain, keys, relationship roles, descriptions, metrics, filters and example queries. Select the relevant [patterns](../patterns/SKILL.md) when the business model calls for temporal, multi-fact, role-playing or derived calculations. The generation call does not automatically read these skills; the outer workflow must check its result.

### Errors and recovery

| Failure | Action |
|---|---|
| Invalid source/request | Check `json_proto`, source workspace/schema/table and string columnNames; inspect structured CLI error |
| Missing source column | Compare the request against actual DESC output, including case and spelling |
| Table not found or permission denied | Verify target/source context and profile; do not guess another database or edit credentials |
| LLM timeout or incomplete JSON | Keep the request/error, retry only with a reason; split along coherent model boundaries when appropriate and preserve the original scope in the final report |
| Invalid generated model | Use validator paths to correct the candidate; do not suppress unsupported semantics |
| VQR cannot compile | Resolve its SQL form and source context through VQR management; do not call an unexecuted query verified |
| Partial deployment/readback conflict | Follow upload/recovery, inspect the actual remote state and journal; a queryable object is not proof of complete deployment |

Do not keep retrying unchanged failing requests without new evidence. If a narrower candidate is the only deliverable, identify it as partial with outstanding requirements.

## Phase 4: Present results and deploy when requested

Report model name, source and target locations, exact file path, tables, metrics/filters, VQR state, validation evidence and unresolved assumptions. Distinguish a local draft from a deployed view.

If the task authorizes deployment, continue through [upload](../upload/SKILL.md) without a redundant confirmation. A generation-only request stops at a validated local candidate.

```bash
cz-cli sv deploy --file-path /tmp/sales.sv.yaml --fqn analytics.semantic.sales_model --profile PROFILE --write
```

Deployment includes readback and VQR compilation. Retain job IDs and distinguish native metadata, managed metadata and query validation status. For a task requiring a usable deployed model, verify representative business computations within scope and report unsupported or failed ones. EXPLAIN alone is not business-result verification.

Use the requirement map to choose representative result comparisons at distinct grains or business roles, prioritizing inferred joins and calculations. Compare with grounded physical SQL on the same source/filter scope, including duplicates and NULLs. Record which requirements were actually checked and which remain untested; passing DDL or recovering metadata does not complete missing business coverage. Do not add a new permission gate or run every optional enrichment merely to fill the map.

## Phase 5: Suggest next steps

After creation, offer relevant enrichment when it is not already included in the task:

1. [Generate descriptions](../generate_description/SKILL.md).
2. [Suggest missing relationships](../suggest_relationships/SKILL.md).
3. [Suggest useful VQRs from permitted history](../vqr_suggestions/SKILL.md).
4. [Suggest metrics, filters and facts](../filters_and_metrics_suggestions/SKILL.md).
5. [Audit quality and best practices](../audit/SKILL.md).

Route according to user intent. If the original request already includes an enhancement, perform it in scope; do not require the user to repeat it. Do not run every optional workflow merely because it exists.

## Completion criteria

- Context and actual sources resolved; request and generated model validated.
- Model saved at the intended path; any requested deployment checked through readback.
- Business scope and supplied-history use explained, including selected/deferred examples.
- Validation evidence and unresolved limitations reported without promoting partial state to complete.
