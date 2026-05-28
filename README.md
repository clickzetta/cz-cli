# cz-cli

AI-Agent-friendly command-line interface for ClickZetta Lakehouse.

```bash
npm install -g @clickzetta/cz-cli
```

## Features

- **Data Agent** — Natural-language Lakehouse operations, one-shot or conversational, powered by AI
- **AI Subagent** — Auto-registers as a skill for Claude Code, Cursor, Codex, and Kiro so your AI coding assistant can operate on Lakehouse directly
- **AI-Friendly Output** — JSON output by default, structured error messages with auto-correction hints
- **SQL Execution** — Run queries directly, with async polling for long-running jobs
- **Studio Task Scheduling** — Create, configure, publish, and monitor scheduled tasks and flows
- **Rich Commands** — SQL, workspace, schema, table, task, runs, attempts, job, and profile management

## Quick Start

### Configure

```bash
cz-cli setup
```

Or with a registration token (non-interactive):

```bash
cz-cli setup --credential <base64_string>
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
| `agent run "<prompt>"` | Run AI agent with a natural-language prompt |
| `sql "<query>"` | Execute a SQL query |
| `table list` | List tables |
| `schema list` | List schemas |
| `task list` | List Studio tasks |
| `runs list` | View task run history |
| `job <job_id>` | Inspect job execution details |
| `profile list` | Manage connection profiles |
| `setup` | Interactive configuration wizard |

### Agent Sessions

```bash
# One-shot (scripts, CI)
cz-cli agent run "create a daily sync task"

# Conversational (reuse context with --session)
cz-cli agent run "describe the sales table" --session my-session
cz-cli agent run "add a region column to sales" --session my-session
```

### AI Subagent Invocation

AI agents call cz-cli in non-TTY environments, which automatically runs asynchronously:

```bash
cz-cli agent run "<request>" --dangerously-skip-permissions
```

Use `--session <id>` for multi-turn conversations on the same topic.

## Installation Options

### npm (recommended)

```bash
npm install -g @clickzetta/cz-cli
```

### Shell Script

```bash
curl -fsSL https://github.com/clickzetta/cz-cli/releases/latest/download/install.sh | sh
```

Pin a specific version:

```bash
CZ_VERSION=0.1.0 curl -fsSL https://github.com/clickzetta/cz-cli/releases/latest/download/install.sh | sh
```

### Manual Install

Download the archive for your platform from [Releases](https://github.com/clickzetta/cz-cli/releases), extract, and run:

```bash
sh setup.sh
```

### Environment Variables

| Variable | Description |
| --- | --- |
| `CZ_VERSION` | Pin a specific version (e.g. `0.1.0`) |
| `CZ_MIRROR` | Custom mirror base URL for downloads |
| `NON_INTERACTIVE` | Skip all interactive prompts |

### Supported Platforms

| Platform | Architecture |
| --- | --- |
| Linux | x64, arm64 |
| macOS | x64 (Intel), arm64 (Apple Silicon) |
| Windows | x64, arm64 |

## License

MIT License.
