**Documentation Reference**: /Users/zhanglin/IdeaProjects/lakehouse_doc (lakehouse SQL、概念、python sdk等文档)

**SQL Commands**:
- List schemas: SHOW SCHEMAS
- Create schema: CREATE SCHEMA
- Drop schema: DROP SCHEMA
- Describe schema: DESC SCHEMA (或查询系统表)

### Requirement: List schemas
The system SHALL list all schemas in the current workspace. The command SHALL accept `--output/-o` for output format.

#### Scenario: List all schemas
- **WHEN** user runs `clickzetta schema list`
- **THEN** system executes SHOW SCHEMAS and returns list of schema names

#### Scenario: List schemas with output format
- **WHEN** user runs `clickzetta schema list -o table`
- **THEN** system returns schema list in table format

#### Scenario: Filter schemas by pattern
- **WHEN** user runs `clickzetta schema list --like 'test%'`
- **THEN** system returns only schemas matching pattern

### Requirement: Create schema
The system SHALL create new schemas. The command SHALL accept `--output/-o` for output format.

#### Scenario: Create schema
- **WHEN** user runs `clickzetta schema create myschema`
- **THEN** system executes CREATE SCHEMA myschema

### Requirement: Drop schema
The system SHALL drop existing schemas. The command SHALL accept `--output/-o` for output format.

#### Scenario: Drop schema
- **WHEN** user runs `clickzetta schema drop myschema`
- **THEN** system executes DROP SCHEMA myschema

### Requirement: Describe schema
The system SHALL show schema details including tables and metadata. The command SHALL accept `--output/-o` for output format.

#### Scenario: Describe schema
- **WHEN** user runs `clickzetta schema describe myschema`
- **THEN** system returns schema information including table count and properties
