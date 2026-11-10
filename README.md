# cz-cli

AI-Agent-friendly command-line interface for ClickZetta Lakehouse.

```bash
curl -fsSL https://cz-cli.ai/install.sh | bash
```

Restart your shell after installation.

## Features

- **Data Agent** — Natural-language Lakehouse operations, one-shot or conversational, powered by AI
- **MCP server** — `cz-cli mcp init` registers cz-cli with Claude Code, Cursor and Codex, so your AI coding assistant can operate on Lakehouse directly
- **Machine-readable output** — JSON by default; `--format` and `--field` for every command, and one error shape per format
- **SQL execution** — Run queries directly, with async polling for long-running jobs
- **Studio task scheduling** — Create, configure, publish and monitor scheduled tasks and flows
- **Rich command surface** — auth/profile, sql, schema, table, workspace, task, runs, attempts, job, datasource, dqc, analytics-agent, ai-gateway

## Quick Start

### Sign in

```bash
cz-cli login my-company
```

Browser OAuth. `my-company` labels this login; cz-cli discovers your instances and
workspaces and creates one connection profile per workspace.

Non-interactive alternatives:

```bash
cz-cli login my-company --credential <base64_string>
cz-cli login my-company --username <username> --password <password> --account-name <account_name>
```

### Use

```bash
cz-cli agent run "show row counts for all tables in my_schema"

cz-cli sql "SELECT * FROM my_schema.my_table LIMIT 10"

cz-cli status
```

## Commands

```bash
cz-cli <command> [options]
```

| Command | Description |
| --- | --- |
| `agent run "<prompt>"` | Run the AI agent with a natural-language prompt |
| `agent llm` | Register and inspect the LLMs the agent uses |
| `sql "<query>"` | Execute SQL (`--file`, `--batch`, `--dry-run`, `--async`) |
| `auth` | Sessions and sign-in: `login`, `logout`, `list`, `status` |
| `profile` | Connection profiles: `list`, `detail`, `create`, `update`, `use`, `delete` |
| `status` | Check the active connection (exit 0 only when it works) |
| `schema` / `table` | Schemas and tables |
| `workspace` / `workspace-param` | Workspace selection and Studio workspace parameters |
| `task` / `runs` / `attempts` | Studio tasks, run instances and attempt records |
| `job` | Job execution details and performance profiles |
| `datasource` | External data sources |
| `dqc` | Data quality check rules |
| `analytics-agent` | Analytics Agent APIs |
| `ai-gateway` | AIGW virtual keys and available models |
| `mcp init` / `mcp serve` | Register cz-cli with an AI client, or serve MCP on stdio |
| `update` / `autoupdate` | Update cz-cli, or configure automatic updates |

Every command takes `--help`.

### Analytics Agent resource updates

Resource definitions can be managed independently of analysis domains:

```bash
# Omit domain/datasource filters to list metrics, including independent ones.
cz-cli analytics-agent metric list --page-size 20

# An omitted datasource uses the backend's system datasource. Domain bindings are optional.
cz-cli analytics-agent metric create --table-name workspace.schema.orders --name orders --expression 'count(*)'
cz-cli analytics-agent metric validate --table-name workspace.schema.orders --name orders --expression 'count(*)'

# Definition patches preserve omitted fields and all domain bindings.
cz-cli analytics-agent metric update 342 --alias '["净营收"]'
cz-cli analytics-agent metric update 342 --description '' --alias '[]'

# Replace the COMPLETE binding list; [] removes all bindings.
cz-cli analytics-agent metric update-domains 342 --domain-ids '[5,6]'
cz-cli analytics-agent metric update-domains 342 --domain-ids '[]'

# Patch a datasource without resending credentials, or validate a connection patch without saving.
cz-cli analytics-agent datasource update 8 --name renamed
cz-cli analytics-agent datasource update 8 --connection '{"host":"new-host"}' --validate-only

# Update domain properties without resending its name.
cz-cli analytics-agent domain update 5 --description 'New description'
cz-cli analytics-agent domain update 5 --sample-questions '[]'

# Answer Builder patches preserve the existing name, datasource and SQL/DSL.
cz-cli analytics-agent answer-builder update 9 --analysis-desc 'New description'
cz-cli analytics-agent answer-builder update 9 --domain-ids '[]'
```

Answer Builder `create` and `validate` also accept omitted `--domain-ids` or `[]`;
name, datasource and a valid SQL/DSL definition are still required. Updating a
SQL/DSL definition requires the complete replacement `--content` (including
`outputColumns`); `--sql` can replace the SQL inside that supplied definition.
Only non-SQL field updates can omit the definition; `--sql` alone still requires
the complete DSL via `--content`, `--content-file`, or a JSON string in `body.content`.
`--body` accepts advanced fields and version metadata. Metric and Answer Builder
updates also expose `--base-version-id` and `--version-description`.

For resource updates, omitted or null definition fields retain their current
values, except that Answer Builder `body.content`, when supplied, must be a
JSON-encoded DSL string. Data source connections merge by field. A blank datasource/domain name
is rejected. A metric's description can be cleared with `''` and aliases with
an explicit `[]`; an alias list containing only whitespace does not clear aliases.
On list commands, omitted or empty domain filters mean no domain filter;
they do not select only unbound resources. Existing knowledge commands retain
their domain requirements.

## CLI configuration

Store CLI preferences in `~/.clickzetta/czcli.json`, alongside settings such as
`autoupdate`:

```json
{
  "autoupdate": false,
  "otel_record_content": true
}
```

When tracing is configured, `otel_record_content` controls recording LLM
inputs/outputs and tool arguments/results. Content can include code and data;
existing redaction and size limits still apply. Setting it to `false` keeps spans,
status, token usage, and available profile identity attributes, but omits content.

Content recording precedence is `OPENCODE_OTEL_RECORD_CONTENT` (`0`/`1`), then
`otel_record_content`, then the legacy top-level `telemetry` boolean in
`~/.clickzetta/profiles.toml`, then `true`. Missing files and missing keys use the
same default. Setup writes new preferences to `czcli.json`; existing legacy
preferences remain readable.

The shared config reader also accepts `~/.clickzetta/czcli.jsonc`, followed by
`$XDG_CONFIG_HOME/clickzetta/{opencode.jsonc,opencode.json,config.json}` (XDG defaults
to `~/.config`). Later files override earlier files per key for content
recording. Automatic updates use their existing migration into `czcli.json`.

## Output

Output is machine-readable by default: a `{"data": …}` envelope on success, a
`{"error": {"code", "message"}}` envelope on failure.

```bash
cz-cli sql "SELECT 1 AS n" --format text     # tab-separated rows, no envelope
cz-cli auth list --field sessions            # one field, bare value
```

| Flag | Values |
| --- | --- |
| `--format` | `json` (default), `pretty`, `table`, `csv`, `text`, `jsonl`, `toon` |
| `--field <path>` | Extract a single field: `data.workspace`, `sessions`, `count` |

Under the row-oriented formats (`text`, `table`, `csv`, `jsonl`) a failure is a single
`ERROR <code>: <message>` line rather than JSON, so one parser handles both.

Exit codes: `0` success, `1` business error, `2` usage error.

## Agent sessions

```bash
# One-shot (scripts, CI)
cz-cli agent run "create a daily sync task"

# Conversational (reuse context with --session)
cz-cli agent run "describe the sales table" --session my-session
cz-cli agent run "add a region column to sales" --session my-session
```

For unattended use add `--dangerously-skip-permissions`, and `--async` to get a session
id back immediately instead of waiting.

## Installation options

### Manual install

Download the archive for your platform from
[Releases](https://github.com/clickzetta/cz-cli/releases), extract, and run:

```bash
sh setup.sh
```

### Pin a version

```bash
curl -fsSL https://cz-cli.ai/install.sh | bash -s -- --version 2.0.8
```

`2.0.8` is an example. The installer reads the version only from its arguments (`--version X`,
`--version=X`, or a bare version), so setting a variable such as `CZ_VERSION` on `curl` has no effect.

### Environment variables

Installer:

| Variable | Description |
| --- | --- |
| `CZ_MIRROR` | Custom mirror base URL for downloads |
| `NON_INTERACTIVE` | Skip all interactive prompts |

Runtime — these override the active profile, which is what makes cz-cli usable in CI
without a `profiles.toml`:

| Variable | Description |
| --- | --- |
| `CZ_PROFILE` | Which profile to use (overrides `default_profile`) |
| `CZ_FORMAT` | Default `--format` value |
| `CZ_PAT` / `CZ_USERNAME` / `CZ_PASSWORD` | Credentials |
| `CZ_SERVICE` / `CZ_PROTOCOL` / `CZ_INSTANCE` / `CZ_WORKSPACE` / `CZ_SCHEMA` / `CZ_VCLUSTER` | Connection target |

### Supported platforms

| Platform | Architecture |
| --- | --- |
| Linux | x64, arm64 |
| macOS | arm64 (Apple Silicon) |
| Windows | x64, arm64 |

## License

MIT License.
