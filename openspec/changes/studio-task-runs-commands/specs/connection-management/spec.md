## ADDED Requirements

### Requirement: PAT to JWT exchange for all commands
The system SHALL support PAT authentication by exchanging PAT for JWT via login_wrapper, then using JWT for both SDK connections and Studio API calls.

#### Scenario: SQL command with PAT profile
- **WHEN** user runs `cz-cli sql "SELECT 1"` with a PAT-based profile
- **THEN** system calls `login_wrapper(instance, pat=pat, url=service_url)` to obtain JWT, then connects to SDK using `magic_token=<jwt>` in the connection URL

#### Scenario: Studio command with PAT profile
- **WHEN** user runs `cz-cli task list` with a PAT-based profile
- **THEN** system calls `login_wrapper(instance, pat=pat, url=service_url)` to obtain JWT, then proceeds with the full StudioConfig creation flow (get_user_id → get_user_config → list_user_workspaces), using JWT as `StudioConfig.token` which becomes the `x-lakehouse-token` header in Studio API calls

#### Scenario: PAT exchange failure
- **WHEN** PAT is invalid or expired
- **THEN** system returns error `{ "error": "AUTH_FAILED", "message": "PAT authentication failed: <reason>" }` before attempting any operation

#### Scenario: PAT priority over username/password
- **WHEN** profile contains both `pat` and `username`/`password` fields (should not happen, but defensive)
- **THEN** system uses PAT authentication, ignoring username/password

### Requirement: Authentication method validation at connection time
The system SHALL validate that exactly one authentication method is configured before attempting any connection.

#### Scenario: No authentication method configured
- **WHEN** profile has neither `pat` nor `username`/`password`
- **THEN** system returns error "Authentication required: set pat or username/password in your profile"

#### Scenario: Connection priority includes PAT
- **WHEN** resolving connection config
- **THEN** priority order is: CLI args (--pat) > env var (CZ_PAT) > profile pat > CLI args (--username/--password) > env vars (CZ_USERNAME/CZ_PASSWORD) > profile username/password

