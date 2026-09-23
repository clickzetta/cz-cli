---
name: cz-semantic-view-upload
description: "Plan, deploy, verify and recover a ClickZetta semantic view with property preservation and conflict checks."
metadata:
  parent-skill: cz-semantic-view
---

# Deploy and Recover a Semantic View

Use the selected connection profile on remote commands (`--profile NAME`). Relative model paths resolve under `cz_project/`; absolute paths are accepted. Read `cz-cli sv capabilities` for the current schema and supported operations. Local output is a model draft; deployment requires `sv deploy --write`. An existing user request to implement/deploy supplies authorization within its scope; do not invent another approval gate.

## Plan before applying

```bash
cz-cli sv plan --file-path /tmp/sales.sv.yaml --fqn analytics.public.sales --profile PROFILE
cz-cli sv deploy --file-path /tmp/sales.sv.yaml --fqn analytics.public.sales --baseline FINGERPRINT --write --profile PROFILE
```

For a new object the baseline is `absent`. When a downloaded model has a matching manifest, deploy automatically uses its recorded remote fingerprint; `--baseline` explicitly overrides it. The plan includes target, generated SQL, existing definition and validation job. Confirm that the target and source bindings match the request. Deployment is authorized when the user requested it; otherwise finish the reviewable local model before seeking approval.

## Actual execution

1. Acquire a local lock scoped by service/instance/workspace/target.
2. Read definition and all properties, compile CREATE or OR REPLACE, EXPLAIN the candidate.
3. Persist a journal and re-read the baseline before submission.
4. Persist the allocated job ID before `/lh/submitJob`; await the normal SDK result.
5. Restore properties, compare structured native metadata, EXPLAIN VQRs, then save and verify managed authoring metadata.

OR REPLACE clears properties on the verified release. Do not bypass restoration with a handwritten replacement. Readback mismatches or failed queries are partial deployment failures, not successful deployment.

## Recovery

```bash
cz-cli sv recover --file-path /absolute/path/to/deployment.json --write --profile PROFILE
```

Recover uses the journal's connection identity, original terminal job state and expected native fingerprint. It restores properties/managed metadata only when the current definition still matches; it does not blindly resubmit the DDL. External modifications yield CONFLICT. Invalid VQRs require model correction and a fresh plan. No automatic rollback overwrites concurrent work. Retain the journal and job ID when reporting failures.

Cross-user grants, distributed simultaneous writers and dependent materialized objects require environment-specific validation; property preservation does not prove those contracts. Report the final target, fingerprint, job ID, query validation and recovery-file path.
