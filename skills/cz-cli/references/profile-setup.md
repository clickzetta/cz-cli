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
cz-cli agent llm add my-claude --provider anthropic --api-key sk-ant-... --use

# Add OpenAI
cz-cli agent llm add my-openai --provider openai --api-key sk-...

# Check what's active
cz-cli agent llm show

# Switch between configured LLMs
cz-cli agent llm use my-claude

# Fall back to ClickZetta built-in
cz-cli agent llm reset

# Full help
cz-cli agent llm --help
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
 "next_steps": ["cz-cli agent llm show", "cz-cli agent llm add <name> --provider <p> --api-key <k> --use"]}

// Profile exists but no api_key, no llm entries
{"ok": false, "error": "NO_PROFILE", "profile_exists": true, "has_llm_entry": false,
 "next_steps": ["cz-cli setup --credential <base64>", "cz-cli agent llm add my-claude --provider anthropic --api-key <key> --use"],
 "supported_providers": ["anthropic", "openai", "openai-compatible", "bedrock", "google", "azure"]}
```

## Step-by-step: no credential available

If the user doesn't have a base64 credential, guide them to:

1. Register at `https://accounts.clickzetta.com/register?ref=cz-cli` (China) or `https://accounts.singdata.com/register?ref=cz-cli` (International)
2. Copy the credential string from the registration page
3. Run `cz-cli setup --credential "<base64_string>"`
