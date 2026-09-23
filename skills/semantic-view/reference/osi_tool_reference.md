# OSI tool reference

## Two distinct paths

`sv import --kind osi` analyzes or converts a local OSI model without deploying. `sv backend --tool osi_write_model --write` converts and directly deploys an authorized lossless candidate. Do not upload again after successful direct registration.

## Input contract

Use exactly one `yaml_content` string or local `file_path` for direct registration; include `target_db_schema` for the destination. Use a request JSON file for large YAML. Remote stage references and warehouse parameters from another service are not implemented. The current profile supplies the ClickZetta connection.

High-level local conversion options: `name`, `workspace`, `schema`, `mapping`, `include_tables`, `include_columns`, `include_measures`. Mapping is per dataset name to `{database?,schema,table}`. Empty selectors mean all. Source table mapping and target deployment location are separate: `target_db_schema` does not rewrite dataset source bindings.

## Model shapes

The reader accepts a single model at top level or through `semantic_model`/`semantic_models`. Multiple models require selection before conversion. Datasets map to logical tables; fields become dimensions with expressions/types/descriptions/synonyms and time hints. Primary/unique keys and equal-column relationship keys are retained. Metrics become model metrics.

Expressions may be strings, `sql`, or dialect entries. The converter chooses the first supplied compatible `CLICKZETTA`/`ANSI_SQL` entry; verify its expression instead of assuming dialect names guarantee compatibility. A missing compatible expression is a loss. Relationship endpoints and column arity must match selected datasets.

AI context and custom extensions are retained in managed metadata, not automatically implemented as native semantics. Unknown OSI features require manual source/output reconciliation; parsing is not a complete standards conformance check.

## Output

Local conversion: `success`, `status`, model/YAML, counts, losses and source format. Direct registration rejects any conversion loss with `LOSSY_IMPORT`, then follows ordinary deployment and returns its target/fingerprint/job evidence inside `data.result`. Do not expect a source-service-only `model_fqn` field.

Direct failure can occur before deployment or after a DDL has been submitted; use the deployment journal/readback to distinguish them. Never retry blindly after an uncertain submit result. Local partial conversion can be saved with explicit `--allow-lossy`, but that does not waive direct registration's loss check.

See [OSI workflow](../import_osi/SKILL.md) for preview, verification and reporting.
