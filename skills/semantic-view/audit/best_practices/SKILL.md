---
name: cz-semantic-view-audit-best-practices
description: "Audit a semantic view for documentation, naming, conflicting definitions, duplicate instructions, missing relationships and quality coverage."
metadata:
  parent-skill: cz-semantic-view-audit
---

# Best Practices Audit

Use for a best-practices review or when the audit router selects this mode. Run the checks below; a successful `sv audit` command alone is not the complete qualitative audit.

## Phase 1: Load the semantic view

```bash
cz-cli sv read --fqn WORKSPACE.SCHEMA.VIEW --out-path /tmp/model.sv.yaml --profile PROFILE
```

For a local model, use `sv read --source workspace --file-path /tmp/model.sv.yaml`. Record whether the audit applies to a local candidate or actual deployed readback. Relative paths resolve under `cz_project/`. For deployment state use the native/managed readback, not an earlier intended model.

## Phase 2: Execute checks

### 2.0: Quality score

```bash
cz-cli sv audit --file-path /tmp/model.sv.yaml --out-path /tmp/audit.json
```

Read [quality score formula](quality_score_formula.md). Present components and coverage score before qualitative findings. The corrected maximum is 6 for multi-table and 5 for single-table models. This score does not establish query correctness, actual uniqueness or valid VQRs.

### 2.0b: Table intelligence

If not already collected, inspect the permitted query history and source metadata for base-table activity. Report the observation window, distinct queries/users where available, and source. For genuine 30-day counts, use HIGH (50+), MEDIUM (10–49), LOW (1–9), UNUSED/NEW (0).

The current CLI does not provide an equivalent automatic table-activity search here. A supplied history file is an evidence source, not proof of complete production activity. Do not relabel synthetic template counts as 30-day user usage; missing counts are UNKNOWN. Respect history allowlists instead of reading global history. Use activity as context, not a reason to discard an explicitly requested low-usage table.

### 2a: General best practices

- Documentation: tables and fields describe meaning and grain; use [description guidelines](../../reference/description_guidelines.md).
- Naming: conventions are consistent and names resolve; quoted/non-ASCII identifiers are not inherently defects when supported.
- Metadata: check declared types against source expressions and separate native from managed fields. Do not assume other clients consume CLI-managed metadata.
- Type safety: dimensions, scalar facts, entity facts and aggregate metrics serve their intended roles.

### 2b: Inconsistencies

Read [inconsistencies](inconsistencies.md). Build column, relationship and metric registries, then check definitions, references, classifications, aggregation and filter conflicts. Apply business-role context before flagging similarly named components.

### 2c: Duplicates

Read [duplicates](duplicates.md). Compare custom instructions against descriptions, synonyms, sample values, metrics and filters; exclude VQR pairs from that comparison. Separately review CLI duplicate-expression and ambiguous-synonym findings. Neither check replaces the other.

### 2d: Missing relationships

Read [missing relationships](missing_relationships.md). Preserve the sparse-relationship threshold check, then check known business paths and disconnected components. A sufficient count is not proof that the required role exists.

For actual declared-key verification within authorized query scope:

```bash
cz-cli sv audit --file-path /tmp/model.sv.yaml --data --profile PROFILE --out-path /tmp/key-audit.json
```

This performs full-table duplicate/NULL checks; retain job IDs and consider source size. An SV key declaration does not enforce uniqueness. Candidate keys, unmatched foreign keys and missing business paths require additional evidence.

## Phase 3: Categorize issues

- Best practices: ERROR for actual failures, WARNING for issues needing attention, INFO for recommendations.
- Inconsistencies: CRITICAL/HIGH/MEDIUM/LOW with observed or suspected impact distinguished.
- Duplicate instructions: exact, high similarity or partial overlap; do not invent measured similarity percentages.
- Unknown/unrun checks: separate from passes and failures.

Each finding needs a component path, evidence, consequence and a proposed fix. An unresolved business definition is a question, not permission to choose an arbitrary meaning.

## Phase 4: Present results

Read [results formatting](results_formatting.md). Report checked scope, quality components, qualitative findings, data checks and unknowns. Include source files/job IDs and distinguish proposed from applied changes.

## Phase 5: Next steps

Route selected fixes according to the gap:

| Gap | Workflow |
|---|---|
| Missing keys | [Edit](../../edit/SKILL.md), after key evidence |
| Missing relationships | [Suggest relationships](../../suggest_relationships/SKILL.md) |
| Missing metrics/filters | [Metrics and filters](../../filters_and_metrics_suggestions/SKILL.md) |
| Insufficient useful VQRs | [VQR suggestions](../../vqr_suggestions/SKILL.md) |
| Shallow or incorrect descriptions | [Descriptions](../../generate_description/SKILL.md) |

For audit-only requests present recommendations and offer fixes, another audit, or completion. If audit-and-fix is already authorized, continue within scope and rerun affected checks; do not add a redundant confirmation gate. Resolve ambiguous business corrections before applying them. Follow upload only when remote deployment is authorized.
