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
- Use `--async` for large or long-running queries, then inspect with `cz-cli job status <job-id>` or fetch with `cz-cli job result <job-id>`.
- Write operations always require `--write`, including DDL and DML.
- If SQL contains quotes, `$`, backticks, backslashes, or newlines, write it to a file and run `cz-cli sql -f <file>` to avoid shell corruption.
- **ClickZetta Lakehouse has its own SQL dialect.** Do NOT assume standard SQL syntax works. Before writing any SQL beyond basic SELECT/INSERT/UPDATE/DELETE, you MUST look up the exact syntax in the lakehouse-doc-en knowledge base. Never guess or trial-and-error SQL syntax — look it up first.

## Job Management

### Show Jobs
```bash
cz-cli job list                        # recent 20 jobs
cz-cli job list --limit 50             # more results
cz-cli job list --status RUNNING       # filter by status (RUNNING/SUCCEED/FAILED/CANCELLED)
```
- Suitable for quick inspection of recent jobs (up to a few hundred).
- For large-scale job analysis (>10,000 jobs), complex filtering, or aggregation, query `INFORMATION_SCHEMA.JOBS` instead:
  ```bash
  cz-cli sql "SELECT job_id, status, start_time, end_time FROM INFORMATION_SCHEMA.JOBS WHERE start_time > '2026-06-01' AND status = 'FAILED' LIMIT 100"
  ```

### Cancel a Job
```bash
cz-cli job cancel <job-id>
```
- Cancels a running job immediately via the API.

### Check Job Status / Get Results
```bash
cz-cli job status <job-id>       # quick status check
cz-cli job result <job-id>       # fetch result set (waits if still running)
cz-cli job profile <job-id>      # execution plan and performance profile
```

## Studio Task Rules

- Always pass `--type` when creating tasks.
- Flow tasks use `cz-cli task flow *` commands for nodes; do not use normal task content/deploy commands on flow nodes.
- Confirm intent before destructive or state-changing operations: deploy, undeploy, execute, delete, refill/backfill, stop, rerun, and similar actions.
- For historical reruns or backfills, use `cz-cli runs refill <task> --from YYYY-MM-DD --to YYYY-MM-DD`; this is under `runs`, not `task`.
- For output table JSON flags such as `--output-tables`, pass the JSON array as one shell argument, usually with single quotes.

## Output Handling

- `--format json`: best for parsing.
- `--format toon`: line-per-field output, useful with `grep` or `head`.
- `--format table`, `--format csv`, `--format pretty`: human-readable.
- `--field <name>`: extracts one field as raw text.
- Paginated list commands usually return page 1; check `ai_message` for next-page hints.

## Command Reference

Read `references/command-reference.md` when you need examples or command coverage beyond these core rules.
