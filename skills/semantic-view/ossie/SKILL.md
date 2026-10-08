---
name: cz-semantic-view-ossie
description: "Work with Apache Ossie (formerly Open Semantic Interchange, OSI) YAML for ClickZetta semantic views: pull a view as Ossie, edit it locally, check status, validate on the server, push it back, or import an external Ossie/OSI file."
metadata:
  parent-skill: cz-semantic-view
---

# Ossie semantic views

Ossie server support is deployment-dependent. First run `sv capabilities --remote --fqn EXISTING_VIEW --profile PROFILE` for export, and validate the actual import document with `--mode remote`. Export success does not certify import or ontology support. The verified release-v1.8 baseline rejects `DESC ... AS OSSIE YAML`; use native [creation](../creation/SKILL.md) or [download](../download/SKILL.md) there. For a supplied Ossie file, retain the local draft and report unsupported server transport; do not silently translate or deploy it.

Read the [Ossie reference](../reference/ossie_reference.md) before editing a document. OSI and Ossie are the same standard: "OSI YAML" usually means version `0.1.1` (a `semantic_model:` list with one model), "Ossie YAML" means `0.2.0.dev0` (model properties at the root). Both are accepted.

The server performs every Ossie conversion (`CREATE ... USING OSSIE YAML`, `DESC ... AS OSSIE YAML`). The CLI only keeps a tracked local copy, previews it, and submits it, like a git working tree. Never translate Ossie into the legacy `.sv.yaml` model by hand, and never hand-write `CREATE SEMANTIC VIEW` DDL from an Ossie file.

## Edit an existing view

```bash
cz-cli sv pull analytics.public.sales --out-path sales.ossie.yaml --profile PROFILE
# edit cz_project/sales.ossie.yaml directly
cz-cli sv status --file-path sales.ossie.yaml --profile PROFILE
cz-cli sv validate --file-path sales.ossie.yaml --mode local
cz-cli sv validate --file-path sales.ossie.yaml --mode remote --profile PROFILE
cz-cli sv push --file-path sales.ossie.yaml --write --profile PROFILE
```

1. **Pull.** Saves the server export plus a `.manifest.json` with the target, connection identity and remote fingerprint. Add `--ossie-version 0.1.1` only when a consumer needs the legacy wrapper. Pull refuses to overwrite a tracked file with unpushed edits.
2. **Edit** the YAML file directly with normal file edits. Keep dataset and field names stable unless a rename is requested, because queries and verified queries reference them.
3. **Status** reports `up_to_date`, `ahead` (local edits, ready to push), `behind` (remote changed, pull first) or `diverged` (both changed; reconcile against a fresh pull in a separate file).
4. **Validate.** The default `--mode local` checks only document shape. Explicit `--mode remote` runs `EXPLAIN CREATE OR REPLACE ... USING OSSIE YAML` and creates nothing. The server result decides validity.
5. **Push** needs `--write`. It re-validates, refuses if the remote changed since the tracked baseline (`CONFLICT`), replaces the view, restores user properties, and re-exports to record the new baseline. `normalized: true` means the server canonicalized the document (for example, dataset-qualified expressions). Pull again if the local file should match the server spelling.

An existing user request to implement or deploy is the authorization for `--write`; do not add a second approval gate.

## Import an external Ossie/OSI file

```bash
cz-cli sv import --kind osi --file-path model.yaml
cz-cli sv import --kind ossie --file-path model.yaml --out-path sales.ossie.yaml --parameters '{"mapping":{"orders":"analytics.public.orders"}}'
cz-cli sv import --kind ossie --file-path model.yaml --fqn analytics.public.sales --write --profile PROFILE
```

- With no flags, import previews the document: version, model name, datasets and their sources, metric and relationship counts, extension vendors, and shape issues.
- `--out-path` writes a tracked draft. Continue with validate and push from there.
- `--write` creates the view on the server. Import only creates: an existing target is a `CONFLICT` unless you pass a `--baseline` taken from `sv status`.
- `--parameters` accepts only `name` (the target view name) and `mapping` (dataset name to table reference). Use mapping when sources differ between environments. Do not try to filter datasets, fields or metrics during import; edit the document instead.
- `--kind osi` and `--kind ossie` behave the same.

The backend tool `osi_write_model` (alias `ossie_write_model`) creates a view directly from `yaml_content` or `file_path` with `target_db_schema`, an optional `name` and an optional `mapping`.

## Report

Report the target FQN, local path, Ossie version, the status/validate/push outcome, job IDs, and any `restored_properties` or `normalized` flags. On `PUSH_UNCERTAIN`, do not retry: run `sv status` to see whether the remote export changed, then decide. Distinguish document shape errors (local), server conversion errors (`semantic.view.ossie.invalid`), unresolved sources or privileges, and conflicts.
