---
name: cz-semantic-view-vqr-suggestions
description: "Recommend verified-query candidates from supplied SQL history or business-question/SQL usage records. Use for seeding examples, reviewing common questions, or finding missing historical coverage."
metadata:
  parent-skill: cz-semantic-view
---

# Suggest verified queries from history

Recover useful question/SQL examples from actual supplied evidence. VQR suggestions are candidates for verification, not a claim that generated SQL is correct.

## Phase 1: identify model and evidence

Start with a local `.sv.yaml`, or `sv read FQN --out-path /tmp/model.sv.yaml --profile PROFILE`. Preserve the model's existing examples so equivalent questions can be deduplicated.

| Evidence mode | When to choose it | Required provenance |
|---|---|---|
| SQL history | Default when SQL records are available; also works before natural-language traffic exists | SQL, source query/job ID, timestamp and actual occurrence count when supplied |
| Natural-language usage | User explicitly asks about questions people asked, and paired question/SQL records are available | Original question, answer SQL, execution/feedback evidence and source record |
| Model-only draft | Neither history source is available | Label as hypothetical coverage suggestions; frequency and real-user usage remain unknown |

The adapter consumes supplied `--history-file` content; it does not automatically mine account history or remote assistant traffic. Backend mode/limit/offset values are not a server history cursor. Never invent usage counts, treat one synthetic execution as popularity, or quietly substitute hypothetical questions for a request about actual users.

A useful history file can contain `queries` with `id`, `question` when known, `sql`, `job_id`, `timestamp`, `frequency`, and `source`. Retain the original SQL. Back-translated questions must be labeled generated and checked against its NULL, filtering, grouping and limit semantics.

## Phase 2: generate candidates

```bash
cz-cli sv suggest --kind verified_query_suggestions --file-path /tmp/model.sv.yaml --history-file /tmp/history.json --out-path /tmp/vqr-suggestions.json
```

The configured LLM returns `suggestions` containing `reason` and structured edit `operations`, plus `warnings`. This differs from a pre-ranked remote suggestion API. Read the saved full JSON, not just a terminal preview. If using `sv backend --tool verified_query_suggestions`, put evidence in the parameters object; parse the JSON string in `data.result`.

## Phase 3: review and rank

For each candidate show the question, SQL, logical/physical targets, source records, observed frequency (or unknown), rationale, and verification status. Recommend useful recurring patterns and coverage gaps; identify duplicates or niche cases instead of blindly adding every historical query.

Rank by observed frequency when comparable records support it, then explain coverage/business priority separately. A count of example templates is not a count of user requests. Two questions that differ only in wording may share one VQR; two SQLs with similar tokens may have different date roles or NULL semantics and must not be merged blindly.

VQRs must use executable physical SQL or native `SEMANTIC_VIEW(...)` syntax against the target. Bare logical aliases in FROM are not resolved by current validation. If a conversion is needed, retain the source and use [VQR management](../vqr_management/SKILL.md). Do not rewrite every source query merely to force SV usage.

## Phase 4: apply and verify

When adding examples is in scope, select candidates based on evidence, explain the selection, and use `sv edit` with `add_vqr` operations. A suggestions-only request stops at review. Do not deploy a draft without authorization for the target; existing authorization to enrich and deploy is sufficient.

Check compilation and the intended business result before assigning verification metadata. Preserve failures as rejected/pending candidates. Report proposed, selected, applied, and verified counts separately, plus uncovered business questions. More suggestions require a new evidence slice or a clearly requested expanded candidate set; repeated generation is not deterministic pagination.

If there are no suggestions, distinguish insufficient history, no novel patterns, model coverage gaps, and provider/permission errors. Do not add unrelated tables just to obtain more suggestions.
