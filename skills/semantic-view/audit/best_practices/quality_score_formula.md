# SV Quality Score Formula

Use `cz-cli sv audit --file-path /tmp/model.sv.yaml` for the deterministic score. For a deployed view, first export through `sv read` so native and integrity-checked managed metadata are decoded consistently. Do not apply another engine's DESCRIBE row schema directly to ClickZetta.

## Extract signals from the normalized model

| Signal | Source |
|---|---|
| Table count | Number of `tables` entries |
| Has keys | Any declared primary key or nonempty unique_keys |
| Has relationships | Nonempty relationships, applicable only to multi-table models |
| Has metrics | Any table-level or top-level metric |
| VQR count | Number of verified_queries entries; their presence does not prove validation |
| Average description length | Mean length of nonempty table and non-filter field descriptions; model/relationship descriptions are not included by this implementation |

## Formula

```text
has_keys          = 1 if present, otherwise 0
has_relationships = 1 if present, otherwise 0 (N/A for one table)
has_metrics       = 1 if present, otherwise 0
vqr_saturation    = 2 * (1 - exp(-(ln(10)/10) * VQR_count))
description_depth = 1 - exp(-(ln(100)/100) * average_nonempty_description_chars)
maximum           = 6 for multiple tables, 5 for a single table
score             = sum(applicable components) / maximum * 100
```

The component maxima add to 6/5; use this corrected denominator consistently. VQR saturation and description length are coverage proxies. Adding redundant examples or longer prose can increase a score without improving behavior. Missing descriptions must also be reported independently, since averaging only nonempty descriptions can hide missing coverage.

## Thresholds and checklist

- At least 70%: good coverage.
- 50–69%: incomplete coverage requiring review.
- Below 50%: low coverage.

These labels do not certify a functioning model, business correctness or key uniqueness.

```text
Quality Score: X/Y (Z%) [Good coverage / Incomplete / Low]

  Has keys          [present / missing; actual verification separate]
  Has relationships [present / missing; required business paths separate]
  Has metrics       [present / missing]
  VQRs: N           [coverage count; validated/executed counts separately]
  Descriptions      [depth and missing descriptions]
```

For a single-table model show `Relationships: N/A (single-table, not scored)` rather than a failed check. Keep score components, CLI findings, qualitative audit and real query-validation results visible as separate evidence. Route gaps to the corresponding editing/suggestion workflow in the parent audit skill.
