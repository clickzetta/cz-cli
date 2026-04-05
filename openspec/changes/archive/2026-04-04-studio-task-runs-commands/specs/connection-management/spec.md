## ADDED Requirements

### Requirement: PAT to JWT exchange for all command families
The system SHALL exchange PAT to JWT via `login_wrapper` and reuse JWT for both SDK and Studio API calls.

#### Scenario: SQL command with PAT profile
- **WHEN** user runs `cz-cli sql "SELECT 1"` using PAT-based auth
- **THEN** system exchanges PAT for JWT and connects SDK with `magic_token=<jwt>`

#### Scenario: Studio command with PAT profile
- **WHEN** user runs `cz-cli task list` using PAT-based auth
- **THEN** system exchanges PAT for JWT and uses JWT in Studio API headers

### Requirement: Authentication priority order
The system SHALL resolve authentication with the following fixed priority:
`--pat` > `CZ_PAT` > profile `pat` > `--username/--password` > `CZ_USERNAME/CZ_PASSWORD` > profile username/password.

#### Scenario: PAT CLI argument wins
- **WHEN** user provides both `--pat` and username/password from lower-priority sources
- **THEN** system uses `--pat` path

#### Scenario: Environment PAT wins over profile PAT
- **WHEN** user sets `CZ_PAT` and profile also contains `pat`
- **THEN** system uses `CZ_PAT`

#### Scenario: No valid auth source
- **WHEN** no PAT and no complete username/password pair can be resolved
- **THEN** system returns clear authentication-required error before any API call

### Requirement: Mutual exclusivity and validation
The system SHALL enforce PAT and username/password as mutually exclusive effective auth methods.

#### Scenario: Mixed inputs resolved by priority
- **WHEN** both PAT and username/password are present across sources
- **THEN** system selects one method by priority and records selected auth mode

#### Scenario: PAT exchange failure
- **WHEN** PAT is invalid or expired
- **THEN** system returns `{ "error": "AUTH_FAILED", "message": "PAT authentication failed: <reason>" }`
