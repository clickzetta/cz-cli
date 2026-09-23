---
name: cz-semantic-view-audit-custom-criteria
description: "Evaluate a semantic model against user-defined naming, type, relationship or business criteria, with per-criterion evidence and unknowns."
metadata:
  parent-skill: cz-semantic-view-audit
---

# Custom Criteria Audit

## Phase 1: Gather criteria

Use the criteria already supplied. If none were provided, ask for conditions such as revenue naming, date types, required customer relationships or metric exclusions. Do not replace user criteria with generic best practices.

## Phase 2: Parse criteria

For each criterion identify its check type, target elements, success/failure conditions, evidence source and exclusions. Clarify materially ambiguous business meanings before marking compliance. Separate YAML-inspectable conditions from source-data or business-policy claims.

## Phase 3: Load the semantic view

```bash
cz-cli sv read --source workspace --file-path /tmp/model.sv.yaml
```

If only a deployed FQN is given, first use `sv read --fqn WORKSPACE.SCHEMA.VIEW --out-path /tmp/model.sv.yaml --profile PROFILE`. Relative paths resolve under `cz_project/`. Record the audited file/version and local or deployed state.

## Phase 4: Execute checks

Scan relevant sections and record specific evidence for each condition. A helper is available:

```bash
cz-cli sv audit --file-path /tmp/model.sv.yaml --criteria 'Revenue excludes cancelled orders; balances use the last daily snapshot' --out-path /tmp/business-audit.json
```

The helper uses the configured LLM. Independently inspect expressions, relationships and material assumptions before accepting findings. A missing cancellation field does not prove cancellations never occur. Query source data when necessary and authorized, saving job IDs. Do not claim a policy verified when only a description states it.

## Phase 5: Categorize results

Classify relevant components as compliant, violating, unknown or not applicable. Distinguish partial compliance from incomplete evidence. Keep denominators and unknown counts visible; do not count unverified checks as passed or modify the coverage score to imply business compliance.

## Phase 6: Present results

Read [results formatting](results_formatting.md). Include original criterion, interpretation, checked scope, component locations, expected/actual values, evidence and recommendations. Calculate a percentage only with a meaningful denominator; an overall percentage additionally requires agreed weighting.

## Phase 7: Next steps

For review-only requests, offer additional criteria, selected fixes through [edit](../../edit/SKILL.md), another audit, or completion. For authorized audit-and-fix, apply unambiguous corrections within scope and rerun affected checks. Ask when business meaning is unresolved, not merely because a phase ended. Remote deployment follows [upload](../../upload/SKILL.md) when authorized.

Completion means each supplied criterion has an evidence-backed status and actionable findings; it does not require inventing answers for unknowns.
