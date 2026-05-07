# Profile Setup — Connection Onboarding Guide

Use this reference when any command returns error code `NO_PROFILE`.

## Preferred: `cz-cli setup`

The recommended first-time onboarding entry point is `cz-cli setup`:

```
cz-cli setup --credential "<base64_string>"
```

Or without `--credential` in an interactive terminal to launch the guided flow:

```
cz-cli setup
```

The main CLI process **does not** automatically launch an interactive quickstart flow.
Instead, when no profile exists, data commands (e.g. `sql`, `table list`) output a
structured `NO_PROFILE` error and exit. The AI agent should then guide the user to
run `cz-cli setup`.

## Non-Interactive / Scripted Setup

For AI agents or automation (non-TTY environments), always pass `--credential`:

```
cz-cli setup --credential "<base64_string>"
```

Or use the equivalent `profile quickstart` subcommand (backward compatible):

```
cz-cli profile quickstart --credential "<base64_string>"
```

Without `--credential`, both commands output registration URLs as JSON:

```
cz-cli setup
cz-cli profile quickstart
```

## Alternative: Choose auth method (advanced)

If the user prefers manual setup, use the **AskUserQuestion tool**. Present three options:

## Step 2 — Collect credentials (branch by choice)

### Branch A — JDBC URL (user already has one)

1. Ask: "Please paste your JDBC URL (format: `jdbc:clickzetta://...`)."
2. If the URL contains the literal placeholder `<password>`, ask for the real password separately and substitute it before use.
3. Derive a profile name from the URL (e.g. `default`) or ask the user.
4. Run:
   ```
   cz-cli profile create <name> --jdbc "<url_with_real_password>"
   ```

### Branch A — JDBC URL (guided copy-from-Studio flow)

If the user doesn't have a JDBC URL, guide them to copy one from Studio:

1. Ask: "What is your Studio page URL?"
2. Do not ask user to identify URL type. Accept any Studio URL directly.
   Examples:
   - `https://rwyaytab.accounts.clickzetta.com/accountManage/accountInfo`
   - `https://czstudio.devops.xiaohongshu.com/accounts/wuhsuxis/login`
   - `https://studio-bj-gaotu.clickzetta-inc.com/app/14743d05`
3. Reply with the exact link to open:
   ```
   <studio_url>/management/environment
   ```
   Then prompt: "Navigate to **工作空间 → 连接配置 → 复制**. This copies a JDBC URL that may contain `<password>` as a placeholder."
4. Ask the user to paste the copied URL, then handle the `<password>` placeholder as above.

### Branch B — PAT

1. Ask for: PAT value, instance name, workspace name (optionally: default schema, vcluster).
2. Run:
   ```
   cz-cli profile create <name> --pat <PAT> --instance <instance name> --workspace <WS>
   ```

### Branch C — Username / Password (recommended discovery flow)

1. Ask for:
   - username
   - password
   - Studio page URL
2. Run the built-in discover command to authenticate and discover regions + instances:
   ```
   cz-cli profile discover \
     --studio-url "<studio_url>" \
     --username "<username>" \
     --password "<password>"
   ```
   The command auto-detects URL type; user does not need to distinguish account URL vs app URL.
3. Ask user to choose region, then list workspaces in that region:
   ```
   cz-cli profile list-workspaces \
     --studio-url "<studio_url>" \
     --username "<username>" \
     --password "<password>" \
     --region "<region_id_or_alias>" \
     --instance "<optional_instance_name>"
   ```
4. Generate a safe `profile create` command (default schema/vcluster included):
   ```
   cz-cli profile render-command \
     --studio-url "<studio_url>" \
     --username "<username>" \
     --password "<password>" \
     --region "<region_id_or_alias>" \
     --instance "<instance_name>" \
     --workspace "<workspace_name>" \
     --profile-name "<profile_name>"
   ```
5. Execute the generated command.

Important:
- Never map tenant/account ID to `--instance`.
- `--instance` must be a real Studio instance name.
- Defaults are `--schema public` and `--vcluster default`.

Manual fallback if all fields are already known:
```
cz-cli profile create <name> \
  --username <U> \
  --password <P> \
  --instance <instance_name> \
  --workspace <workspace_name> \
  --service <service_host> \
  --schema public \
  --vcluster default
```

## Step 3 — Verify and proceed

- Check `exit_code=0` and `ok=true` in JSON output.
- On success, proceed with the original request using `--profile <name>`.
- On failure, show the error and ask the user to re-check credentials.
