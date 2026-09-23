---
name: cz-semantic-view-import-osi
description: "Import an OSI/Open Semantic Interchange model into ClickZetta, preview dataset mappings and losses, then convert locally or directly register an authorized model."
metadata:
  parent-skill: cz-semantic-view
---

# Import OSI

Read [OSI tool reference](../reference/osi_tool_reference.md). Distinguish local conversion from direct registration; do not deploy a model twice because both paths exist.

## 1. Load and preview

Use a local OSI YAML file or a supplied inline document. For large content use a request file, not a shell argument. The adapter does not implement remote stage-path fetching or require a size-based upload workflow. Preserve the original input and select exactly one semantic model.

Preview model name, datasets, relationships, metrics, target workspace/schema and source mappings. Confirm unknown physical mappings from metadata or the user; do not infer transformations from a matching display name.

## 2. Choose the path

For a reviewable local candidate:

```bash
cz-cli sv import --kind osi --file-path /tmp/source.yaml --mode local
cz-cli sv import --kind osi --file-path /tmp/source.yaml --out-path /tmp/imported.sv.yaml --parameters '{"name":"imported","workspace":"analytics","schema":"public"}'
```

The first command analyzes only; the second converts. Current support includes dataset fields, compatible SQL expressions, keys, equal-column relationships, metrics and selected AI context. Check the reference for dialect and loss boundaries. Actual source data is not imported by this operation.

For direct registration, save a request to a JSON file:

```json
{"tool":"osi_write_model","parameters":{"file_path":"/tmp/source.yaml","target_db_schema":"analytics.public"}}
```

```bash
cz-cli sv backend --file-path /tmp/osi-request.json --write --profile PROFILE
```

Use exactly one of local `file_path` or `yaml_content` in the parameters. The outer `--file-path` above is the request JSON, not the OSI model. Direct registration must be within the user's authorized target; it rejects conversion losses and uses the normal deployment/readback path. A successful direct registration is already live: do not route it to upload again.

## 3. Review and verify

Parse the CLI response; backend `data.result` is itself JSON text. For local conversion inspect `success`, `status`, counts and `losses`; losses block saving unless a partial candidate is explicitly requested with `--allow-lossy`. Direct registration reports normal deployment fields such as target/fingerprint/job ID, not a fabricated `model_fqn` contract.

Verify source bindings and compiled SQL against the selected profile. Compare key measures and relationships to the original requirement. Preserved custom extensions or AI context in managed metadata do not mean the engine implements every extension.

## 4. Report state and errors

Distinguish malformed YAML, multiple models, unresolved sources, unsupported dialects, missing privileges and partial deployment. Report model identity, counts, mapping, retained/dropped semantics, evidence and current state. For a local candidate with deployment requested, continue through [upload](../upload/SKILL.md); for direct registration, read back and verify without a second create.
