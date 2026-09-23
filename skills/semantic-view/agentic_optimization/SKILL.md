---
name: cz-semantic-view-agentic-optimization
description: "Start, inspect, list, cancel, or review persistent semantic-model optimization jobs. Prefer for iterative job-style improvement; route one-off field/VQR suggestions and specific modeling patterns to their dedicated workflows."
metadata:
  parent-skill: cz-semantic-view
---

# Optimize a semantic view

This adapter runs a persistent local worker using the configured LLM and, when requested, real ClickZetta evaluations. It is not a replica of a remote proprietary optimization service. Job completion produces a local best candidate, not an automatic replacement of the original view.

## Phase 1: identify intent and target

Distinguish start, status/results, history, and cancellation. For one-off examples use [VQR suggestions](../vqr_suggestions/SKILL.md), for field extraction use [filters/metrics](../filters_and_metrics_suggestions/SKILL.md), and for a specified modeling shape use [patterns](../patterns/SKILL.md).

Read a local model or download the view with `sv read FQN --out-path /tmp/sales.sv.yaml --profile PROFILE`. Preserve the baseline. Establish which business behavior should improve and which source bindings and trusted SQL must remain unchanged.

## Phase 2: find an existing job before starting another

```bash
cz-cli sv optimize --action list --state-root /tmp/sv-optimization
cz-cli sv optimize --action get --id JOB_ID --state-root /tmp/sv-optimization
```

Use the same state root as the original run; the default is `cz_project/.sv/optimizations` relative to the working directory. LIST returns IDs, states, timestamps and scores. GET includes the model and target. Inspect candidates to match the requested model; do not assume every job in the directory is for it.

If exactly one matching job is active, inspect it. If several match, use known task context or clarify the identity. For a completed job, return its result without rerunning it. A status-only request does not authorize launching another job. A failed or cancelled job retains its history; inspect the cause before choosing a new run.

## Phase 3: choose evidence and budget

Check VQRs before accuracy optimization. `--evaluate` requires an existing target and 1–10 trusted VQRs; route an empty model to VQR collection/verification first. A metadata-only run may proceed without VQRs, but only measures the deterministic audit score, not question accuracy.

```bash
cz-cli sv optimize --file-path /tmp/sales.sv.yaml --iterations 3 --state-root /tmp/sv-optimization --profile PROFILE
```

Iterations must be 1–20. Without `--foreground`, the worker detaches and persists progress; with it, the command waits for the run. Preserve the returned job ID, state root and log path immediately. Avoid duplicate jobs when the create response is interrupted: list/get first.

For accuracy evaluation add:

```bash
cz-cli sv optimize --file-path /tmp/sales.sv.yaml --iterations 3 --evaluate --fqn analytics.public.sales --profile PROFILE --state-root /tmp/sv-optimization
```

Each question's exact VQR is held out from generation, but related examples or descriptions may remain. The worker compares complete bounded result multisets, up to 10,000 rows; no sampled result is called equivalent. Ordering and correctness beyond the trusted suite are not established. This suite drives optimization, so it is a development objective, not an independent test set.

## Phase 4: inspect progress and terminal state

Use GET at a bounded cadence appropriate to the run, typically about 30 seconds while actively observing. States are `queued`, `running`, `completed`, `failed`, `cancelled`; report state, completed iterations, accepted/rejected changes and errors. A stale running record with a missing worker is surfaced as failed. Do not infer a live process from a file alone, and do not restart solely because a status observation timed out.

`--action run` is the worker entrypoint for a queued job, not a general resume operation. Interrupted running jobs cannot be resumed implicitly; preserve the best model and create a separate job only when continuing is in scope. Do not promise automatic background notifications without an actual configured follow-up mechanism.

## Phase 5: cancel when requested

```bash
cz-cli sv optimize --action cancel --id JOB_ID --state-root /tmp/sv-optimization
```

A `cancel_requested` response records a durable cancellation request; it is not proof that the worker has stopped. GET the state to confirm. Cancelling a terminal job returns its terminal state without changing it. An active request may be aborted; preserve any best candidate and history already saved.

## Phase 6: review the candidate and evidence

GET exposes baseline/best model, audit score, optional accuracy, evaluations and iteration history. Compare definitions and group changes into descriptions/synonyms, instructions, VQRs and structural changes. Show accepted and rejected proposals with reasons, assumptions and query/job evidence.

A higher audit score can result from fuller descriptions and is not evidence of higher business accuracy. Existing trusted VQRs and SQL semantics must remain stable unless the explicit structural objective permits a tested change. New VQR SQL must occur verbatim in supplied `--history-file` and pass compilation; generated SQL is not automatically trusted ground truth.

## Phase 7: structural optimization and applying results

Use `--semantic-changes --evaluate --write` only when structural changes and disposable target-schema views are authorized. Each candidate is deployed to a unique temporary view, compared against trusted results and removed in a finally block. Physical source bindings cannot be invented or changed. An accuracy regression or deployment failure rejects the candidate; cleanup failures must be reported.

The original view is never replaced by this loop. Review the saved `JOB_ID.sv.yaml`, apply selected edits through [edit](../edit/SKILL.md) or [VQR management](../vqr_management/SKILL.md), validate, and use [upload](../upload/SKILL.md) when deployment is in scope. Existing authorization applies; a suggestions-only request ends with reviewable candidates.

## Phase 8: history and reporting

Use LIST then GET to revisit a past run. Before reapplying old proposals, compare their baseline with today's model. Report job identity, target, objective, actual terminal state, evidence-backed changes, rejected changes, costs when recorded, candidate path and deployment status. Provider failures, invalid source bindings, untrusted queries or missing profile access are distinct from "no useful improvement".
