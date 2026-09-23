---
name: cz-agent-studio
description: Route ClickZetta semantic view authoring, validation, deployment, querying, audit, import and optimization requests to the matching cz-cli sv workflow.
metadata:
  short-description: ClickZetta semantic view workflows
---

# ClickZetta Agent Studio

Use `cz-cli sv` for every semantic view operation. Read the matching skill below before acting; the command implementation is the source of truth for flags and capability errors.

- Creation, generation and local files: [semantic-view/creation/SKILL.md](../semantic-view/creation/SKILL.md)
- Questions using existing semantic views: [querying guide](../semantic-view/reference/querying_existing_views.md). Native SEMANTIC_VIEW SQL through `cz-cli sql` is also valid; inspect actual coverage before choosing a physical fallback.
- Read/download and edits: [semantic-view/download/SKILL.md](../semantic-view/download/SKILL.md), [semantic-view/edit/SKILL.md](../semantic-view/edit/SKILL.md)
- Validation, planning and deployment: [semantic-view/validate/SKILL.md](../semantic-view/validate/SKILL.md), [semantic-view/upload/SKILL.md](../semantic-view/upload/SKILL.md)
- Suggestions, VQRs and instructions: read their respective skills under `semantic-view/`.
- OSI imports: use [OSI import](../semantic-view/import_osi/SKILL.md); lossy conversions produce a loss report and require `--allow-lossy` for local output. Tableau and Power BI conversion are outside this release.
- Audits and optimization: read `audit/` or `agentic_optimization/` as applicable.

The native ClickZetta release tested by this skill supports dimensions, scalar/entity facts, metrics, relationships including ASOF, private access, window and non-additive metrics, and AI verified queries. Filters, sample values, data types, false traits, custom instructions and import provenance are managed authoring metadata. Range relationships, many-to-many semantics, non-left joins and computed relationship keys are rejected before deployment.

Remote mutations require explicit `--write`. `sv plan` and `sv validate` are read-only. `sv deploy` journals the target, expected native fingerprint, submitted job id and property restoration; use `sv recover` only after inspecting the recorded journal. Never claim generated, suggested or imported output is deployed or verified until the command reports that state.
