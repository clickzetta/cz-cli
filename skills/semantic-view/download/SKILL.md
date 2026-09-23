---
name: cz-semantic-view-download
description: "Read a ClickZetta semantic view into a local model while retaining native details and managed metadata."
metadata:
  parent-skill: cz-semantic-view
---

# Download a Semantic View

Use the selected connection profile on remote commands (`--profile NAME`). Relative model paths resolve under `cz_project/`; absolute paths are accepted. Read `cz-cli sv capabilities` for the current schema and supported operations. Local output is a model draft; deployment requires `sv deploy --write`. An existing user request to implement/deploy supplies authorization within its scope; do not invent another approval gate.

1. Resolve the target explicitly or use `sv list` / `sv search --query TERM` in the selected schema.
2. Read JSON DESC and properties via `sv read`; save YAML using `--out-path`.
3. Record the returned fingerprint, `managed_status`, `unmapped`, creator and modification metadata. Use the fingerprint as `--baseline` on a subsequent deployment.
4. If metadata is stale, keep the native model and original raw evidence. Reconcile the external change before attempting replacement. Do not assert a YAML round trip is lossless when `unmapped` is nonempty.

```bash
cz-cli sv read analytics.public.sales --out-path /tmp/sales.sv.yaml --profile PROFILE
cz-cli sv read --source workspace --file-path /tmp/sales.sv.yaml
```

A downloaded file receives a `.manifest.json` sidecar with its source profile name, connection identity, target, remote fingerprint/version, local fingerprint and timestamp. It contains no credentials. Local edits retain the remote baseline; deployment uses that baseline unless explicitly overridden. Saving the model does not modify server state. Download uses structured metadata because SHOW CREATE can omit traits/indexes and misquote non-additive dimensions. Lists are limited by `--limit` and report truncation; search reads full model metadata within the selected schema.


## Identity and file checks

Use a view already identified in the conversation. A partial name may be resolved by a schema-scoped list/search, but multiple matches require selecting the intended target rather than choosing the first. An empty list may reflect permissions or truncation; it does not prove the object was deleted.

Before saving, check whether the chosen file already contains local work. Save to a new path or reconcile changes when necessary. Prefer `sv read --out-path` to copying a large YAML string through shell arguments. `--source workspace` only reads the local file and does not refresh it from the server.

After saving, inspect model identity, physical bindings, tables/fields/relationships/VQRs and the manifest's target/profile/fingerprints. Report actual source FQN, saved path, tracking status, managed metadata status and any unmapped fields. Never label the round trip complete when native fields were not represented. Continue to [edit](../edit/SKILL.md) for requested local changes and [upload](../upload/SKILL.md) for deployment.
