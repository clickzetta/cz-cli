# cz-cli Command Reference

Use `cz-cli <command> --help` for authoritative options. This reference is a compact command map for common operations.

## SQL and Jobs

```bash
cz-cli sql "<statement>"                  # Execute SQL, sync by default
cz-cli sql "<statement>" --async          # Return job_id immediately for large/long-running queries
cz-cli sql status <job-id>                # Check async SQL job status
cz-cli job status <job-id>                # Job status and summary
cz-cli job result <job-id>                # Fetch job result set
cz-cli job profile <job-id>               # Flattened job profile basics; use --raw for raw content
```

## Schemas and Tables

```bash
cz-cli schema list [--like <pattern>]
cz-cli schema describe <name>
cz-cli schema create <name>
cz-cli schema drop <name>

cz-cli table list [--schema <name>]
cz-cli table describe <name>
cz-cli table preview <name>
cz-cli table stats <name>
cz-cli table history [name]
cz-cli table create "<ddl>"
cz-cli table drop <name>
```

## Workspaces and Profiles

```bash
cz-cli workspace current
cz-cli status
cz-cli profile list
```

## Studio Tasks

```bash
cz-cli task list
cz-cli task create <name> --type <TYPE>       # SQL/PYTHON/SHELL/SPARK/FLOW/MERGE
cz-cli task content <task>                    # Draft script, config, params, input_params, output_params
cz-cli task save-content <task> --file <f>    # Save task script; --params JSON sets runtime params
cz-cli task save-config <task>                # Save non-cron config: retry, deps, VC, schema, timeout; --param key=value merges params
cz-cli task save-merge <task>                 # Save MERGE rule content and upstream schedule dependencies
cz-cli task save-cron <task>                  # Save cron schedule config
cz-cli task lineage <task>                    # Parse outputs/dependencies; returns save_payload
cz-cli task deps <task>                       # Draft dependencies
cz-cli task deploy <task>                     # Publish/deploy; alias: online
cz-cli task undeploy <task>                   # Undeploy; alias: offline
cz-cli task execute <task>                    # Ad-hoc execution
cz-cli task delete <task>                     # Delete draft/offline task
cz-cli task flow dag <task>                   # Get flow DAG
cz-cli task flow node-save <task> --name N    # Save node script/params; supports --param, --flow-param, --output-param, --input-param
```

For standalone task params:

```bash
cz-cli task save-content <task> --file script.sql --params '{"city":"beijing","dt":"bizdate","yd":"$[yyyy-MM-dd,-1d]"}'
cz-cli task save-config <task> --param city=shanghai --param tenant=acme
```

`save-content --params` stores params while saving content. `save-config --param key=value` merges overrides with existing task params and preserves script content. System params such as `bizdate`, `sys_plan_day`, and `sys_biz_datetime` are auto-detected for JSON `--params` values.

For flow node params:

```bash
cz-cli task flow node-save <flow> --name upstream --output-param result_value
cz-cli task flow bind <flow> --upstream upstream --downstream downstream
cz-cli task flow node-save <flow> --name downstream --input-param up_value=upstream
cz-cli task flow node-save <flow> --name worker --param city=beijing --flow-param bizdate
```

`--output-param key` declares an output value as `$[output]`. `--input-param key=upstreamNodeName` resolves the upstream node id from the flow DAG, so create/bind nodes before using it. `--flow-param key` marks a child node param as inherited from the parent flow execution params (`ref=2`).

For merge tasks:

```bash
cz-cli task create merge_task --type MERGE --folder <folder>
cz-cli task save-merge merge_task --dependency upstream_task --status SUCCESS --status FAILED --status SKIPPED
```

`save-merge` writes the merge rule content and saves the upstream task as a schedule dependency. `--status` is repeatable or comma-separated. `SKIPPED` only applies to upstream if/condition tasks.

For manual output tables, quote JSON as one argument:

```bash
cz-cli task save-config <task> --outputs replace --output-tables '[{"outputTableName":"ws.table","refTableName":"ws.public.table"}]'
```

## Offline Integration Sync (`task integration`)

```bash
cz-cli task integration setup <task> --sync-type single|multi|whole_db \
  --source-datasource <ds> --source-schema <db> --source-table <t> \
  --sink-datasource <lh> --sink-schema <schema> --sink-table <t> \
  --write-mode OVERWRITE|APPEND|UPSERT
cz-cli task integration show <task>           # Current field/table mapping and sync params
cz-cli task integration edit <task>           # Edit mapping/params (applied+saved immediately)
```

Single-table partition (opt-in via `--partitioned`; default is a plain non-partition table):

```bash
# static — whole batch to one partition value; auto-creates PARTITIONED BY (dt STRING)
cz-cli task integration setup <task> ... --partitioned --partitions 'dt=${bizdate}'
# dynamic — per-row routing by a source column (must exist in the source table)
cz-cli task integration setup <task> ... --partitioned --dynamic-partition 'dt:create_time'
```

`--partitions` and `--dynamic-partition` are mutually exclusive; partition column defaults to `dt`. Integration tasks must run on an INTEGRATION-type VC.

## Realtime CDC Pipeline Lifecycle (`task cdc`)

For multi-table CDC pipelines (MULTI_REALTIME, fileType 281, created via `task create-realtime-sync`). NOT for single-table Kafka streaming (fileType 14) — those use `task start` / `task stop`.

```bash
cz-cli task cdc list                          # List CDC pipeline tasks
cz-cli task cdc tables <task>                 # List pipeline tables (returns per-table ids)
cz-cli task cdc offline <task>                # Take pipeline offline (back to draft)
cz-cli task cdc start-table <task> --table-ids <id,id>    # Start incremental sync for tables
cz-cli task cdc stop-table <task> --table-ids <id,id>     # Stop incremental sync for tables
cz-cli task cdc resync-table <task> --table-ids <id,id>   # Re-snapshot tables
cz-cli task cdc pause-table <task> --table-ids <id,id>    # Pause incremental sync
cz-cli task cdc recover-table <task> --table-ids <id,id>  # Resume incremental sync
```

Get table ids from `task cdc tables` first — the `*-table` ops require them. Every `task cdc` command validates fileType 281.

## Runs and Attempts

```bash
cz-cli runs list [--task <name>]
cz-cli runs detail <id>
cz-cli runs wait <id>
cz-cli runs logs <id>
cz-cli runs deps <task>                       # Published dependencies
cz-cli runs stop <id>
cz-cli runs refill <task> --from D --to D     # D is YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS
cz-cli runs rerun <id>
cz-cli runs stats

cz-cli attempts list [id]
cz-cli attempts log [id]
```

## Datasources

```bash
cz-cli datasource list [--type <type>] [--name <filter>]
cz-cli datasource catalogs <name_or_id>
cz-cli datasource objects <name_or_id> <catalog>
cz-cli datasource describe <name_or_id> <catalog> <object>
cz-cli datasource test <name_or_id>
cz-cli datasource sample <name_or_id> <catalog> <object>
```

## AI Gateway

```bash
cz-cli ai-gateway key list
cz-cli ai-gateway key create <alias>
cz-cli ai-gateway key upsert <alias>
cz-cli ai-gateway key get <ref>
cz-cli ai-gateway key set-quota --ref R --period P --quota N
cz-cli ai-gateway key enable <ref>
cz-cli ai-gateway key disable <ref>
cz-cli ai-gateway key delete <ref>
cz-cli ai-gateway model list [ref]
```

Useful key flags:

- `key list`: `--alias`, `--key`, `--status 1|0`, `--mine`, `--reveal`
- `key create/upsert`: `--period daily|weekly|monthly|total`, `--quota N`, `--route-type default|provider|byok`, `--providers <id ...>`, `--provider-sort price|throughput|latency`, `--private-keys <alias ...>`, `--add-to-llm [name]`, `--use`
- `key get`: `<ref>` can be an alias, masked key, or key value; supports `--add-to-llm [name]` and `--use`
- `key delete`: `--remove-from-llm`
