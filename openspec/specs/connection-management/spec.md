**JDBC URL Parsing Reference**: /Users/zhanglin/IdeaProjects/clickzetta-java/jdbc/src/main/java/com/clickzetta/client/jdbc/core/CZConnectContext.java

### Requirement: Multi-source connection resolution
The system SHALL resolve connection configuration from profile, environment variables, JDBC URL, and CLI overrides.

#### Scenario: Connect using profile
- **WHEN** user runs `cz-cli --profile myprofile sql "SELECT 1"`
- **THEN** system loads base connection config from `~/.clickzetta/profiles.toml`

#### Scenario: Connect using JDBC URL
- **WHEN** user runs `cz-cli --jdbc "jdbc:clickzetta://host/instance?username=user&password=pass&workspace=ws" sql "SELECT 1"`
- **THEN** system parses JDBC URL and extracts service/instance/auth/query parameters

#### Scenario: Connect using environment variables
- **WHEN** user sets `CZ_USERNAME/CZ_PASSWORD/CZ_INSTANCE/CZ_WORKSPACE` and runs `cz-cli sql "SELECT 1"`
- **THEN** system reads connection config from environment variables

### Requirement: Non-auth field priority and protocol normalization
For non-auth fields (`service/protocol/instance/workspace/schema/vcluster`), the system SHALL apply source priority: profile < env < jdbc < CLI, and SHALL normalize protocol to `http|https` with fallback `https`.

#### Scenario: CLI protocol override
- **WHEN** user runs `cz-cli --protocol http --service dev-api.clickzetta.com ...`
- **THEN** resulting base service URL uses `http://dev-api.clickzetta.com`

#### Scenario: Invalid protocol fallback
- **WHEN** a source provides unsupported protocol value
- **THEN** system falls back to `https`

### Requirement: Authentication priority and exclusivity
The system SHALL resolve authentication with fixed priority and use one effective auth mode.

#### Scenario: Authentication priority order
- **WHEN** multiple auth sources are present
- **THEN** system resolves in this order: `--pat` > `CZ_PAT` > profile `pat` > CLI user/pass (with fallback fill) > JDBC user/pass > env user/pass > profile user/pass

#### Scenario: PAT wins over user/password
- **WHEN** PAT and username/password are both available across sources
- **THEN** system uses PAT mode and clears username/password from effective config

#### Scenario: CLI partial user/password fallback merge
- **WHEN** user provides only `--username` or only `--password`
- **THEN** system may fill the missing side from JDBC/env/profile according to implemented fallback order
- **AND** only uses password mode when both username and password are resolved

### Requirement: PAT to JWT exchange for SQL and Studio commands
PAT authentication SHALL be exchanged to JWT via `login_wrapper` and reused for downstream APIs.

#### Scenario: SQL command with PAT
- **WHEN** user runs `cz-cli sql "SELECT 1"` using PAT
- **THEN** system exchanges PAT to JWT and connects SDK with `magic_token=<jwt>`

#### Scenario: Studio command with PAT
- **WHEN** user runs `cz-cli task list` using PAT
- **THEN** system exchanges PAT to JWT and uses JWT in Studio API headers/session config

### Requirement: Connection validation before connect
The system SHALL validate required connection fields before establishing SDK connection.

#### Scenario: Missing auth source
- **WHEN** neither PAT nor complete username/password can be resolved
- **THEN** system fails with authentication-required error

#### Scenario: Missing instance
- **WHEN** effective config has no `instance`
- **THEN** system fails with instance-required error

#### Scenario: Missing workspace
- **WHEN** effective config has no `workspace`
- **THEN** system fails with workspace-required error

### Requirement: ClickZetta SDK integration
The system SHALL use clickzetta-connector SDK for SQL/data-plane connections.

#### Scenario: Establish connection
- **WHEN** system has valid effective connection config
- **THEN** system calls `clickzetta.connector.v0.connection.connect()` with resolved parameters
