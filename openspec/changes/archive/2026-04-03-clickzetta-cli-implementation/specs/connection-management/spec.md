## ADDED Requirements

**JDBC URL Parsing Reference**: /Users/zhanglin/IdeaProjects/clickzetta-java/jdbc/src/main/java/com/clickzetta/client/jdbc/core/CZConnectContext.java


### Requirement: Multi-source connection resolution
The system SHALL resolve connection configuration from multiple sources with defined priority.

#### Scenario: Connect using profile
- **WHEN** user runs `clickzetta --profile myprofile sql "SELECT 1"`
- **THEN** system loads connection config from ~/.clickzetta/profiles.toml[profiles.myprofile]

#### Scenario: Connect using JDBC URL
- **WHEN** user runs `clickzetta --jdbc "jdbc:clickzetta://host/warehouse?username=user&password=pass&workspace=ws" sql "SELECT 1"`
- **THEN** system parses JDBC URL and extracts all connection parameters

#### Scenario: Connect using environment variables
- **WHEN** user sets CZ_USERNAME, CZ_PASSWORD, CZ_INSTANCE, CZ_WORKSPACE and runs `clickzetta sql "SELECT 1"`
- **THEN** system reads connection config from environment variables

#### Scenario: Priority order - CLI overrides JDBC
- **WHEN** user provides both --jdbc and --username parameters
- **THEN** system uses --username value, overriding JDBC URL username

### Requirement: Connection validation
The system SHALL validate required connection parameters before attempting connection.

#### Scenario: Missing required parameter
- **WHEN** user attempts connection without username
- **THEN** system returns error "Username is required. Set via profile, environment variable, or --username"

### Requirement: ClickZetta SDK integration
The system SHALL use clickzetta-connector SDK for all database connections.

#### Scenario: Establish connection
- **WHEN** system has valid connection config
- **THEN** system calls clickzetta.connector.v0.connection.connect() with all parameters
