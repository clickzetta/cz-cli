# Task cdc lookup

`task cdc lookup` finds which realtime pipelines sync a source table, across all tasks. It calls the rocket query `POST /api/v1/task/pipeline/table/tasks/query` (ZS-19772) through `/clickzetta-rocket/...` with the login identity.

`task cdc lookup --datasource <name or id> --table <table> [--db <db>] [--schema <schema>] [--match exact|like|prefix|suffix] [--page 1] [--page-size 20]`

- `--datasource` takes a name or an ID and is resolved with the tenant-wide datasource search.
- `--db` and `--schema` match exactly; `--match` sets how `--table` is matched (`exact`, `like` for contains, `prefix`, `suffix`).
- `--page-size` must be between 1 and 200; the command checks that before any request.
- Only the source side is queried. The backend also filters by target database, schema and table; this command does not expose that.

## Output

One row per source table and pipeline that syncs it, so a table synced by two pipelines takes two rows. The message reports `showing X of Y rows`, where `Y` is the total of rows, not of tables. No row means no pipeline syncs the table, and the message says so.

Row fields: `task_id`, `task_name`, `pipeline_type`, `pipeline_status`, `datasource_id`, `source_db`, `source_schema`, `source_table`, `target_db`, `target_schema`, `target_table` and `snapshot_task_status`.

- `pipeline_type` is named for the known values: `MULTI_TABLE_MIRROR` (1), `MULTI_TABLE_MERGE` (2) and `DATABASE_MIRROR` (3). Any other value stays the backend code.
- `pipeline_status` and `snapshot_task_status` are the backend's status codes, unchanged. There is no reliable code table to translate them.
- For MySQL `source_schema` equals `source_db`. `target_db` is the target workspace name.

Sources: [command](../../packages/cz-cli/src/commands/task.ts), [SDK call](../../packages/clickzetta-sdk/src/studio/task.ts), [tests](../../packages/cz-cli/test/task-cdc-lookup.test.ts).
