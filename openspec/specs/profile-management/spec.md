**Configuration File**: `~/.clickzetta/profiles.toml` (TOML format)

### Requirement: Profile creation with mutually exclusive auth modes
The system SHALL support creating profiles with either PAT auth or username/password auth.

#### Scenario: Create profile with PAT
- **WHEN** user runs `cz-cli profile create myprofile --pat <token> --instance inst --workspace ws --service dev-api.clickzetta.com`
- **THEN** system stores `pat` in profile and does not require username/password

#### Scenario: Create profile with username/password
- **WHEN** user runs `cz-cli profile create myprofile --username user --password pass --instance inst --workspace ws --service dev-api.clickzetta.com`
- **THEN** system stores `username` and `password` in profile

#### Scenario: PAT and username/password both provided
- **WHEN** user runs `cz-cli profile create myprofile --pat <token> --username user --password pass ...`
- **THEN** system rejects request with mutual-exclusion error

#### Scenario: Missing authentication arguments
- **WHEN** user runs `cz-cli profile create myprofile --instance inst --workspace ws` without PAT or complete username/password
- **THEN** system rejects request with authentication-required usage error

### Requirement: Profile creation supports protocol and verification control
The system SHALL support optional `--protocol` and `--skip-verify` on profile creation.

#### Scenario: Create profile with protocol
- **WHEN** user runs `cz-cli profile create ... --protocol http`
- **THEN** profile stores normalized protocol value (`http` or `https`)

#### Scenario: Skip connection verification
- **WHEN** user runs `cz-cli profile create ... --skip-verify`
- **THEN** system skips connection test before saving profile

#### Scenario: Default create validates connectivity
- **WHEN** user runs `cz-cli profile create ...` without `--skip-verify`
- **THEN** system tests connection and fails with `CONNECTION_FAILED` if verification cannot pass

### Requirement: Profile listing masks sensitive fields
The system SHALL list profiles without exposing sensitive credentials.

#### Scenario: List profiles
- **WHEN** user runs `cz-cli profile list`
- **THEN** response includes `name/auth_mode/service/protocol/instance/workspace/is_default`
- **AND** PAT is masked as first 8 chars plus `****`
- **AND** password is never returned

#### Scenario: List profiles when none exist
- **WHEN** no profiles are configured
- **THEN** system returns empty list with `ok=true`

### Requirement: Default profile selection
The system SHALL support setting and reading default profile via `default_profile` marker.

#### Scenario: Set default profile
- **WHEN** user runs `cz-cli profile use myprofile`
- **THEN** system writes `default_profile = "myprofile"` in profile file

#### Scenario: Resolve default profile in runtime
- **WHEN** user does not pass `--profile`
- **THEN** connection resolver uses `default_profile` if present, otherwise falls back to first available profile

### Requirement: Profile update behavior
The system SHALL support updating one allowed key at a time and maintain auth-mode consistency.

#### Scenario: Update allowed profile key
- **WHEN** user runs `cz-cli profile update myprofile service uat-api.clickzetta.com`
- **THEN** system updates only the specified key

#### Scenario: Update protocol with invalid value
- **WHEN** user runs `cz-cli profile update myprofile protocol ftp`
- **THEN** system rejects request because protocol must be `http|https`

#### Scenario: Update PAT clears username/password
- **WHEN** user runs `cz-cli profile update myprofile pat <new_token>`
- **THEN** system removes existing `username/password` fields from profile

#### Scenario: Update username or password clears PAT
- **WHEN** user runs `cz-cli profile update myprofile username new_user`
- **THEN** system removes existing `pat` field from profile

### Requirement: Profile deletion
The system SHALL delete named profiles and return not-found errors for missing profiles.

#### Scenario: Delete profile
- **WHEN** user runs `cz-cli profile delete myprofile`
- **THEN** system removes `myprofile` from profile file

#### Scenario: Delete non-existent profile
- **WHEN** user runs `cz-cli profile delete missing`
- **THEN** system returns profile-not-found error
