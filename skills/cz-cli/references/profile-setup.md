# Profile Setup — Connection Onboarding Guide

Use this reference when any command returns error code `NO_PROFILE`.

## Preferred: `cz-cli setup`

The recommended first-time onboarding entry point:

```
cz-cli setup --credential "<base64_string>"
```

Or interactive (TTY only):

```
cz-cli setup
```

For AI agents (non-TTY), always pass `--credential`. Without it, the command outputs JSON with registration URLs and exits 1.

## What setup does

Writes two files:
- `~/.clickzetta/profiles.toml` — connection profile (`[profiles.default]`)
- `~/.local/share/clickzetta/auth.json` — API key

## Profile management

List profiles (forwarded to cz-tool):
```
cz-cli profile list
```

All `cz-cli profile *` subcommands are forwarded to the `cz-tool` binary at `~/.clickzetta/cz-tool/cz-tool`.

## LLM configuration

After setup, the ClickZetta built-in LLM is used by default. To use a different LLM:

```bash
# Add and select Claude
cz-agent llm add my-claude --provider anthropic --api-key sk-ant-... --use

# Add OpenAI
cz-agent llm add my-openai --provider openai --api-key sk-...

# Check what's active
cz-agent llm show

# Switch between configured LLMs
cz-agent llm use my-claude

# Fall back to ClickZetta built-in
cz-agent llm reset

# Full help
cz-agent llm --help
```

Supported providers: `anthropic`, `openai`, `openai-compatible`, `bedrock`, `google`, `azure`

For `openai-compatible` (third-party relays), add `--base-url <url>`.

## Error JSON reference

```json
// No profile at all
{"ok": false, "error": "NO_PROFILE", "profile_exists": false,
 "next_steps": ["cz-cli setup --credential <base64>"],
 "register_urls": ["https://accounts.clickzetta.com/register?ref=cz-cli"]}

// Profile exists but no api_key, has llm entries
{"ok": false, "error": "NO_PROFILE", "profile_exists": true, "has_llm_entry": true,
 "next_steps": ["cz-agent llm show", "cz-agent llm add <name> --provider <p> --api-key <k> --use"]}

// Profile exists but no api_key, no llm entries
{"ok": false, "error": "NO_PROFILE", "profile_exists": true, "has_llm_entry": false,
 "next_steps": ["cz-cli setup --credential <base64>", "cz-agent llm add my-claude --provider anthropic --api-key <key> --use"],
 "supported_providers": ["anthropic", "openai", "openai-compatible", "bedrock", "google", "azure"]}
```

## Alternative: username/password profile (no credential required)

If the user has an existing instance account (username + password) but no base64 credential, use `cz-cli profile create` directly:

```bash
cz-cli profile create <name> \
  --username <username> \
  --password <password> \
  --instance <instance_name> \
  --workspace <workspace_name> \
  --service <service_host> \
  --schema public \
  --vcluster default
```

**Common service endpoints:**

| 云区域 | service |
|--------|---------|
| 阿里云 华东2（上海） | `cn-shanghai-alicloud.api.clickzetta.com` |
| 腾讯云 华东（上海） | `ap-shanghai-tencentcloud.api.clickzetta.com` |
| 腾讯云 华北（北京） | `ap-beijing-tencentcloud.api.clickzetta.com` |
| 腾讯云 华南（广州） | `ap-guangzhou-tencentcloud.api.clickzetta.com` |
| AWS 中国（北京） | `cn-north-1-aws.api.clickzetta.com` |

After creating, verify with:
```bash
cz-cli status --profile <name>
```

Note: `profile discover` / `list-workspaces` / `render-command` require a Studio page URL (`https://<instance>.accounts.clickzetta.com`) and are not usable when only a service endpoint + credentials are available.

## Step-by-step: no credential available

If the user doesn't have a base64 credential, guide them to:

1. Register at `https://accounts.clickzetta.com/register?ref=cz-cli` (China) or `https://accounts.singdata.com/register?ref=cz-cli` (International)
2. Copy the credential string from the registration page
3. Run `cz-cli setup --credential "<base64_string>"`
