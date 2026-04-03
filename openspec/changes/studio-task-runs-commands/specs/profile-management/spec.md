## ADDED Requirements

### Requirement: PAT authentication in profile
The system SHALL support PAT (Personal Access Token) as a mutually exclusive alternative to username/password in profile configuration.

#### Scenario: Create profile with PAT
- **WHEN** user runs `cz-cli profile create myprofile --pat <token> --instance inst --workspace ws --service dev-api.clickzetta.com`
- **THEN** system creates profile with `pat` field in ~/.clickzetta/profiles.toml, without requiring username/password

#### Scenario: Create profile with username/password
- **WHEN** user runs `cz-cli profile create myprofile --username user --password pass --instance inst --workspace ws --service dev-api.clickzetta.com`
- **THEN** system creates profile with `username` and `password` fields

#### Scenario: PAT and username/password are mutually exclusive
- **WHEN** user runs `cz-cli profile create myprofile --pat <token> --username user --password pass ...`
- **THEN** system returns error "Cannot specify both --pat and --username/--password. Choose one authentication method."

#### Scenario: Neither PAT nor username/password provided
- **WHEN** user runs `cz-cli profile create myprofile --instance inst --workspace ws --service svc` without `--pat` or `--username`/`--password`
- **THEN** system returns error "Authentication required: provide either --pat or both --username and --password"

#### Scenario: PAT profile listed without sensitive data
- **WHEN** user runs `cz-cli profile list`
- **THEN** system displays PAT profiles with `auth_mode: pat` and masked token (first 8 chars + `****`), no password field

#### Scenario: Update profile to use PAT
- **WHEN** user runs `cz-cli profile update myprofile pat <new_token>`
- **THEN** system updates the `pat` field and removes `username`/`password` fields

#### Scenario: Environment variable PAT support
- **WHEN** user sets `CZ_PAT=<token>` environment variable
- **THEN** system uses PAT for authentication, equivalent to profile `pat` field

