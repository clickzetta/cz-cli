---
name: cz-cli-inner
description: Use when answering operational ClickZetta Studio or Lakehouse requests from inside a cz-cli-aware agent, including listing metadata, running SQL, managing tasks, checking runs, or operating datasource and AI Gateway resources.
---

# cz-cli Inner

Use `cz-cli` proactively for ClickZetta operational requests. Do not ask for information that can be discovered with `cz-cli` commands.

## Core Rules

- Use `cz-cli` from `PATH` for Lakehouse and Studio operations.
- Run `cz-cli <command> --help` when exact flags are unclear.
- Prefer `--format json` for machine-readable output and preserve `ai_message` guidance.
- Use `--profile <name>` when the user names an environment or profile.
- On `NO_PROFILE`, guide the user to run `cz-cli setup`.
- Stop after the same command fails twice or repeated minor variations make no progress; report what failed and change approach or ask for guidance.
- Never fabricate URLs, task IDs, run IDs, table names, or profile names. Use exact command output.

## SQL Rules

- Current default SQL mode is sync: `cz-cli sql "SELECT ..."` waits for results.
- Use `--async` for large or long-running queries, then inspect with `cz-cli sql status <job-id>` or `cz-cli job status <job-id>`.
- Write operations always require `--write`, including DDL and DML.
- If SQL contains quotes, `$`, backticks, backslashes, or newlines, write it to a file and run `cz-cli sql -f <file>` to avoid shell corruption.
- Use ClickZetta Lakehouse SQL syntax only. Before generating, modifying, validating, explaining, or running non-trivial Lakehouse SQL, load the Lakehouse documentation skill if available.

## Studio Task Rules

- Always pass `--type` when creating tasks.
- Flow tasks use `cz-cli task flow *` commands for nodes; do not use normal task content/deploy commands on flow nodes.
- Confirm intent before destructive or state-changing operations: deploy, undeploy, execute, delete, refill/backfill, stop, rerun, and similar actions.
- For historical reruns or backfills, use `cz-cli runs refill <task> --from YYYY-MM-DD --to YYYY-MM-DD`; this is under `runs`, not `task`.
- For output table JSON flags such as `--output-tables`, pass the JSON array as one shell argument, usually with single quotes.
- `cz-cli task cdc *` commands operate on multi-table CDC pipelines only (MULTI_REALTIME, fileType 281). Single-table Kafka streaming tasks (fileType 14) use `task start` / `task stop`, not `task cdc`.

## Output Handling

- `--format json`: best for parsing.
- `--format toon`: line-per-field output, useful with `grep` or `head`.
- `--format table`, `--format csv`, `--format pretty`: human-readable.
- `--field <name>`: extracts one field as raw text.
- Paginated list commands usually return page 1; check `ai_message` for next-page hints.

## Command Reference

Read `references/command-reference.md` when you need examples or command coverage beyond these core rules.
