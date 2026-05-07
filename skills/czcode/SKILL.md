---
name: czcode
description: Routes coding and software development tasks to czcode AI assistant. Use when user asks to write, debug, refactor, or explain code; develop Python/Shell Studio tasks; review code; or asks general programming questions. Do NOT use for SQL execution on Lakehouse, task scheduling, table/schema management, or profile configuration -- those stay with cz-cli.
metadata:
  author: ClickZetta
  version: "1.1.0"
  compatibility: Requires czcode installed and ANTHROPIC_API_KEY configured
---

# czcode Skill

## Install

```bash
# Install czcode
# Download from releases or build from source: ~/code/cz-code
# Verify installation
which czcode && czcode --version

# Prerequisite: set your API key
export ANTHROPIC_API_KEY=your_key_here
# Or configure in ~/.clickzetta/czcode.json

# Install this skill via cz-cli
cz-cli install-skills
```

This skill enables your coding agent to delegate software development tasks to czcode -- ClickZetta's AI coding assistant -- running headlessly in the background, with full security controls and audit logging.

## Architecture Overview

**Routing Principle**: Coding and development tasks -> czcode. Lakehouse operations -> cz-cli.

**Key Components**:
- `scripts/route_request.py` -- LLM-based semantic routing with credential blocking
- `scripts/execute_czcode.py` -- Headless czcode execution with NDJSON stream parsing and heartbeat
- `scripts/security_wrapper.py` -- Full security orchestration (approval, audit, sanitization)
- `scripts/read_czcode_sessions.py` -- Recent session context enrichment
- `security/` -- Approval handler, audit logger, cache manager, config manager, prompt sanitizer

**Security Modes**:
- `prompt` (default): User approves predicted tools before execution
- `auto`: Auto-approve with mandatory audit logging
- `envelope_only`: Auto-approve, rely on envelope blocklist only

> **IMPORTANT -- `config.yaml` is optional.** If absent, safe defaults apply (`approval_mode: prompt`). Do NOT search for `config.yaml` before executing -- `ConfigManager` handles this internally.

## Fast Path for Repeat Queries

**Session state is cached -- skip re-initialization on follow-up queries.**

For a follow-up coding request in the same session:
1. Skip context re-fetch (reuse Lakehouse context from first query)
2. Call `execute_czcode.py` directly with the enriched prompt
3. Return results

## Session Initialization

When this skill is first loaded in a session:

### Step 1: Load Routing Context
```bash
PYTHON=$(command -v python3 2>/dev/null || echo python3)
$PYTHON scripts/route_request.py --prompt "test" --dry-run 2>/dev/null || true
```
This warms up the config and cache. Skip on follow-up queries.

## Workflow: Handling User Requests

### Step 1: Route the Request

```bash
PYTHON=$(command -v python3 2>/dev/null || echo python3)
$PYTHON scripts/route_request.py --prompt "USER_PROMPT_HERE"
```

**Route to czcode** if request involves:
- Writing, creating, or modifying code (Python, SQL scripts, Shell, etc.)
- Debugging, fixing errors, or diagnosing code issues
- Refactoring or optimizing existing code
- Explaining or reviewing code
- Developing Studio task bodies (Python/Shell)
- General programming questions or best practices
- User explicitly mentions "czcode"

**Handle locally with cz-cli** if request involves:
- Executing SQL on ClickZetta Lakehouse (`cz-cli sql`)
- Managing Studio tasks (create, schedule, online/offline)
- Table or schema operations
- Profile/connection configuration
- Checking run status or execution logs

If routing returns `cz_cli`: handle with cz-cli commands directly. Stop here.

### Step 2: Enrich Context

Build an enriched prompt with Lakehouse context and recent session history:

**Lakehouse Context** (if a cz-cli profile is active):
```bash
cz-cli profile list -o json 2>/dev/null | python3 -c "
import sys, json
profiles = json.load(sys.stdin).get('data', [])
if profiles:
    p = profiles[0]
    print(f'ClickZetta Lakehouse: instance={p.get(\"instance\",\"\")}, workspace={p.get(\"workspace\",\"\")}, schema={p.get(\"schema\",\"\")}')" 2>/dev/null
```

**Recent czcode Session Context** (optional, for follow-up tasks):
```bash
PYTHON=$(command -v python3 2>/dev/null || echo python3)
$PYTHON scripts/read_czcode_sessions.py --limit 2
```

**Enriched Prompt Format**:
```
# Lakehouse Context
[Connection info if relevant to the task]

# Recent czcode Work
[Summary from recent czcode sessions, if relevant]

# User Request
[Original user prompt]
```

### Step 3: Handle Security Approval

```bash
PYTHON=$(command -v python3 2>/dev/null || echo python3)
$PYTHON scripts/security_wrapper.py \
  --prompt "ENRICHED_PROMPT" \
  --envelope "RW"
```

- If `status: awaiting_approval` -> show `approval_prompt` to user, wait for response
- If `status: routed_to_cz_cli` -> handle with cz-cli directly
- If `status: blocked` -> inform user, do not proceed
- If `status: executed` or `approval_mode: auto/envelope_only` -> proceed to Step 4

### Step 4: Execute czcode Headlessly

```bash
PYTHON=$(command -v python3 2>/dev/null || echo python3)
$PYTHON scripts/execute_czcode.py \
  --prompt "ENRICHED_PROMPT" \
  --envelope "RW" \
  --approval-mode auto
```

With Lakehouse context injection:
```bash
$PYTHON scripts/execute_czcode.py \
  --prompt "ENRICHED_PROMPT" \
  --envelope "RW" \
  --approval-mode auto \
  --system-prompt "ClickZetta Lakehouse: instance=INSTANCE, workspace=WORKSPACE, schema=SCHEMA"
```

**Key flags**:
- `--permission-mode bypass` is set internally -- headless auto-approval
- `--output-format stream-json` -- NDJSON event stream, parsed in real-time
- Heartbeat thread prevents AI tool timeouts during long-running tasks

**Security Envelopes**:
- **RO**: Blocks Edit, Write, destructive Bash -- for read-only tasks
- **RW**: Blocks only destructive ops (rm -rf, sudo rm) -- for most coding tasks
- **RESEARCH**: Read + web access, blocks writes -- for exploratory work
- **DEPLOY**: Full access -- use cautiously, requires confirmation

### Step 5: Return Results

- Display czcode's text output to the user
- Report any files created or modified
- If czcode wrote code to be saved as a Studio task: suggest `cz-cli task save`

## Examples

### Example 1: Develop a Python Studio Task
**User says**: "Write a Python task that reads from table `orders` and writes aggregated results to `orders_summary`"

**Routing**: -> czcode

**Execute**:
```bash
$PYTHON scripts/execute_czcode.py \
  --prompt "Write a Python task that reads from ClickZetta table 'orders' and writes aggregated results to 'orders_summary'. Use the clickzetta connector." \
  --envelope "RW" \
  --system-prompt "ClickZetta Lakehouse: instance=my-instance, workspace=default, schema=public"
```

**Result**: Python task code returned -> save via `cz-cli task save`.

### Example 2: Debug a Failing Task
**User says**: "My Python task is throwing a KeyError on line 42"

**Routing**: -> czcode (debugging)

**Envelope**: RO (read-only -- just diagnosing)

### Example 3: Execute SQL on Lakehouse
**User says**: "Run `SELECT COUNT(*) FROM orders`"

**Routing**: -> cz-cli

```bash
cz-cli sql "SELECT COUNT(*) FROM orders"
```

No czcode involvement.

### Example 4: Code Review
**User says**: "Review this Python script for bugs"

**Routing**: -> czcode

**Envelope**: RO (read-only review)

## Troubleshooting

### Error: "czcode: command not found"
```bash
which czcode || ls ~/.local/bin/czcode
# Fallback: use absolute path
~/.local/bin/czcode --print "..." --permission-mode bypass
```

### Error: "ANTHROPIC_API_KEY not set"
```bash
export ANTHROPIC_API_KEY=your_key_here
# Or check: cat ~/.clickzetta/czcode.json
```

### Issue: czcode hangs without output
**Cause**: Not using `--print` flag in non-TTY environment.
**Solution**: Always use `execute_czcode.py` -- never invoke `czcode` directly without `--print`.

### Issue: Approval prompts not appearing
```bash
# Check approval mode
cat "$(dirname $(which czcode))/../skills/czcode/config.yaml" 2>/dev/null | grep approval_mode
# Default is "prompt" -- shows approval prompts
```

### Issue: Audit log not created
```bash
# Ensure log directory exists
mkdir -p ~/.cache/czcode-skill
chmod 700 ~/.cache/czcode-skill
```

### Issue: Output too verbose
Use `--output-format text` in `execute_czcode.py` for plain text when stream parsing isn't needed.

## Configuration

Copy `config.yaml.example` to `config.yaml` in the skill's install directory to customize:
- `approval_mode`: prompt / auto / envelope_only
- `audit_log_path`: where to write audit logs
- `sanitize_conversation_history`: enable/disable PII removal
- `credential_file_allowlist`: paths that block routing when mentioned in prompts

## References

- czcode source: `~/code/cz-code`
- czcode config: `~/.clickzetta/czcode.json`
- Audit log: `~/.cache/czcode-skill/audit.log` (default)
- Cache: `~/.cache/czcode-skill/`
- cz-cli skill: install via `cz-cli install-skills`
