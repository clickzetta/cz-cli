# Profile Setup — Connection Onboarding Guide

Use this reference when any command returns error code `NO_PROFILE`.

## Sign in: `cz-cli auth login <name>`

The onboarding entry point. `<name>` labels the login session.

```
cz-cli auth login <name>
```

Run `cz-cli auth login --help` for the full list of sign-in methods (browser
OAuth, `--credential <base64>`, and `--username`/`--password`). Do not restate
the flags here — the help output is the source of truth.

For AI agents (non-TTY), pass an explicit method (`--credential` or
`--username`/`--password`); a bare OAuth login needs a browser.

## Profile management

`cz-cli profile list` / `use` / `detail` / `delete`. Run `cz-cli profile --help`.

## LLM configuration

The ClickZetta built-in LLM is configured on login. To use a different LLM, run
`cz-cli agent llm --help` (`add` / `use` / `show` / `reset`).

## Error JSON reference

```json
// No profile at all
{"ok": false, "error": "NO_PROFILE", "profile_exists": false,
 "next_steps": ["cz-cli auth login <name>"],
 "register_urls": ["https://accounts.clickzetta.com/register?ref=cz-cli"]}

// Profile exists but no api_key, no llm entries
{"ok": false, "error": "NO_PROFILE", "profile_exists": true, "has_llm_entry": false,
 "next_steps": ["cz-cli auth login <name>", "cz-cli agent llm add <name> --provider <p> --api-key <k> --use"]}
```

## Alternative: create a profile directly (existing username/password account)

When the user has an instance account but no login session, a profile can be
created directly with `cz-cli profile create` — run `cz-cli profile create --help`
for the fields. Register at `https://accounts.clickzetta.com/register?ref=cz-cli`
(China) or `https://accounts.singdata.com/register?ref=cz-cli` (International).
