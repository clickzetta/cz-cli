---
name: cz-semantic-view-audit
description: "Route ClickZetta model quality audits and business-specific acceptance checks."
metadata:
  parent-skill: cz-semantic-view
---

# Audit Semantic Views

Use the selected connection profile on remote commands (`--profile NAME`). Relative model paths resolve under `cz_project/`; absolute paths are accepted. Read `cz-cli sv capabilities` for the current schema and supported operations. Local output is a model draft; deployment requires `sv deploy --write`. An existing user request to implement/deploy supplies authorization within its scope; do not invent another approval gate.

Read [best practices](best_practices/SKILL.md) for structure, duplicates, relationships and coverage scoring. Read [custom criteria](custom_criteria/SKILL.md) when the user supplies business rules. Both may apply.

```bash
cz-cli sv audit --file-path /tmp/sales.sv.yaml --out-path /tmp/audit.json
cz-cli sv audit --file-path /tmp/sales.sv.yaml --data --profile PROFILE
```

Local findings are deterministic. Data audits run full-table key duplicate/NULL checks and can be expensive; choose scope according to the user's request and environment. A quality score is descriptive coverage, not a certificate of semantic correctness. Keep findings tied to exact model fields and evidence. Audit does not mutate the model.
