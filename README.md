# cz-cli

AI-Agent-friendly command-line interface for ClickZetta Lakehouse.

```bash
curl -fsSL https://github.com/clickzetta/cz-cli/releases/latest/download/install.sh | sh
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
CZ_VERSION=0.1.0 curl -fsSL https://github.com/clickzetta/cz-cli/releases/latest/download/install.sh | sh
```

### Environment variables

Installer:

| Variable | Description |
| --- | --- |
| `CZ_VERSION` | Pin a specific version (e.g. `0.1.0`) |
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
