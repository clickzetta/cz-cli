---
name: cz-cli-inner
description: "ClickZetta Lakehouse operations via cz-cli. Use when the user needs SQL queries, Studio task management, table/schema operations, run monitoring, or job inspection."
---

# cz-cli — ClickZetta Lakehouse Operations

You have `cz-cli` available in PATH. Use it via bash to operate on ClickZetta Lakehouse.

Run `cz-cli <command> --help` for detailed options on any command.

## Command Reference

```
cz-cli sql "<statement>" [--sync] [--write]   Execute SQL (async by default, --sync waits for result)
cz-cli sql status <job-id>                    Check async job status

cz-cli schema list [--like <pattern>]         List schemas
cz-cli schema describe <name>                 Describe a schema
cz-cli schema create <name>                   Create a schema
cz-cli schema drop <name>                     Drop a schema

cz-cli table list [--schema <name>]           List tables
cz-cli table describe <name>                  Describe table columns
cz-cli table preview <name>                   Preview table data
cz-cli table stats <name>                     Row count and job summary
cz-cli table history [name]                   Show table history
cz-cli table create "<ddl>"                   Create table from DDL
cz-cli table drop <name>                      Drop a table

cz-cli workspace current                      Show current workspace

cz-cli task list                              List Studio tasks
cz-cli task create <name> --type <TYPE>       Create task (SQL/PYTHON/SHELL/SPARK/FLOW)
cz-cli task content <task>                    Get task script and config
cz-cli task save-content <task> --file <f>    Save task script
cz-cli task save-config <task>                Save task non-cron config, like retry, dependency
cz-cli task save-cron <task>                  Save task schedule config
cz-cli task deps <task>                       Show task dependencies (draft)
cz-cli task deploy <task>                     Publish/deploy a task (alias: online)
cz-cli task undeploy <task>                   Undeploy a task, irreversible (alias: offline)
cz-cli task execute <task>                    Execute ad-hoc
cz-cli task delete <task>                     Delete draft/offline task
cz-cli task flow dag <task>                   Get flow DAG
cz-cli task flow create-node <task>           Add node to flow
cz-cli task flow remove-node <task>           Remove node
cz-cli task flow bind <task>                  Create dependency
cz-cli task flow unbind <task>                Remove dependency
cz-cli task flow node-detail <task>           Get node detail
cz-cli task flow node-save <task>             Save node script
cz-cli task flow node-save-config <task>      Save node config
cz-cli task flow submit <task>                Publish flow
cz-cli task flow instances <task>             List flow node instances

cz-cli runs list [--task <name>]              List run instances
cz-cli runs detail <id>                       Get run detail
cz-cli runs wait <id>                         Poll until complete
cz-cli runs logs <id>                         Get execution log
cz-cli runs deps <task>                       Published dependencies
cz-cli runs stop <id>                         Stop a running instance
cz-cli runs refill <task>                     Backfill date range
cz-cli runs rerun <id>                        Rerun failed instance
cz-cli runs stats                             Run statistics summary

cz-cli attempts list [id]                     List attempts for a run
cz-cli attempts log [id]                      Get attempt log

cz-cli job status <job-id>                    Job status/summary
cz-cli job result <job-id>                    Fetch job result set

cz-cli status                                 Check connection status
cz-cli profile list                           List connection profiles

cz-cli datasource list [--type <type>] [--name <filter>]
                                              List external data sources (type: mysql/kafka/redis/postgresql/...)
cz-cli datasource catalogs <name_or_id>      List catalogs (databases/topics/buckets) in a data source
cz-cli datasource objects <name_or_id> <catalog>
                                              List objects (tables/topics/collections) in a catalog
cz-cli datasource describe <name_or_id> <catalog> <object>
                                              Show object metadata (columns, types)
cz-cli datasource test <name_or_id>          Test data source connectivity
```

## Output Formats

- `-o json` (default) — single-line JSON, best for parsing
- `-o toon` — line-per-field, good for `grep`/`head`
- `-o table` / `-o csv` / `-o pretty` — human-readable
- `--field <name>` — extract one field as raw text

## Key Rules

1. **SQL is async by default**. Use `--sync` for SELECT when you need data immediately.
2. **Write operations require `--write` flag** (INSERT/UPDATE/DELETE/CREATE/DROP).
3. **Always pass `--type` when creating tasks** (SQL/PYTHON/SHELL/SPARK/FLOW).
4. **Flow tasks use `task flow *` commands exclusively** — never use `task save-content` or `task deploy` on flow nodes.
5. **Paginated results**: `list` commands return page 1 only. Check `ai_message` in response for next-page hints.
6. **State-changing operations** (deploy/undeploy/execute/delete/refill): confirm intent with user first.
7. **Multi-environment**: use `--profile <name>` to target a specific environment.
8. **On `NO_PROFILE` error**: guide user to run `cz-cli setup`.

## Companion Skills

When the task involves writing SQL or Python task code, load these skills for accuracy:
- **lakehouse-doc** — SQL syntax, functions, data types, DDL/DML for ClickZetta dialect
- **lakehouse-python-sdk** — Python/Shell task development, BulkLoad, IGS, connector
