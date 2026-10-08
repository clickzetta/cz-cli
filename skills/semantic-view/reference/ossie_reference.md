# Ossie reference

## Server contract

| Purpose | SQL run by the CLI |
|---|---|
| Create or replace | `CREATE [OR REPLACE] SEMANTIC VIEW <fqn> USING OSSIE YAML AS '<document>'` |
| Validate | `EXPLAIN CREATE OR REPLACE SEMANTIC VIEW <fqn> USING OSSIE YAML AS '<document>'` |
| Export | `DESC SEMANTIC VIEW <fqn> AS OSSIE YAML [VERSION '0.1.1']` (default `0.2.0.dev0`) |

The SQL target name wins. The document's `name` is descriptive and is used only as the default target name on import. The imported document goes through the same type, relationship and grain checks as native DDL. Servers built before this support reject `USING OSSIE YAML` with a syntax error; report that as a server-version limitation.

## Document shape

- `0.2.0.dev0`: `version`, `name`, optional `description`, non-empty `datasets`, optional `relationships`, `metrics`, `ai_context`, `custom_extensions`, all at the root. A `semantic_model` wrapper is rejected.
- `0.1.1`: `version: "0.1.1"` plus `semantic_model:`, a list with exactly one model that holds the same properties.
- A dataset has `name`, `source` (a table reference), optional `primary_key`, `unique_keys`, `description`, `ai_context.synonyms` and `fields`.
- A field with a `dimension:` key (even `{}`) becomes a dimension; `dimension: {is_time: true}` marks it as time. A field without `dimension` becomes a fact. Field expressions are dataset-scoped; the server qualifies bare column references with the dataset name.
- Every expression is `expression: {dialects: [{dialect, expression}]}`. The server picks `ANSI_SQL`, then `SNOWFLAKE`, then `OSSIE_SQL_2026`. Any other dialect alone is an error.
- A metric is a top-level aggregate such as `SUM(orders.amount)`.
- A relationship has `name`, `from`, `to`, `from_columns`, `to_columns` of equal length.

## ClickZetta extensions

Features outside the Ossie core live in a `custom_extensions` entry with `vendor_name: CLICKZETTA` (`COMMON` plus `"clickzetta_extension": true` in 0.1.1). `data` is a JSON string, so edit it as JSON inside the YAML string and keep it valid.

- Model level: `filter` (the auto-applied filter), `variables`, `verified_queries` (`name`, `question`, `sql`, optional `verified_at`, `verified_by`, `onboarding_question`).
- Field and metric level: `original_name`, `is_private`, `is_unique`, `enum_values`, `using_relationships`, `non_additive_by`.
- Relationship level: `{"kind": "ASOF", "asof_column_index": N}`.

`ai_context` is read only for `synonyms`. Free-text `ai_context.instructions` is not applied by the engine; do not claim it changes query generation.

## Local tracking

`sv pull`, `sv import --out-path` and `sv push` maintain `<file>.manifest.json`: `format: ossie`, `ossie_version`, target, connection identity and the remote fingerprint, which is a hash of the server export in that version. Status and push compare the remote export against that baseline. A manifest from another connection or target is not used as a baseline; pass `--baseline` explicitly in that case. Manifests hold no credentials.

## Native model commands

`edit`, `audit`, `suggest`, `optimize`, `query` and `deploy` operate on native `.sv.yaml`, the default workflow for current deployments. Given an Ossie file they return `OSSIE_DOCUMENT`. To analyze an already deployed view authored in Ossie, pass `--fqn` so those commands read its native definition. Deploying a local Ossie draft first requires server support and deployment scope; do not convert it locally or deploy merely to inspect it.
