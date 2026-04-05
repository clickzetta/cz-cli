## ADDED Requirements

### Requirement: Template-based skill document generation
The system SHALL support rendering skill command sections from a fixed template plus dynamic command metadata.

#### Scenario: generate skill document command inventory
- **WHEN** skill documentation is generated
- **THEN** fixed template sections remain unchanged
- **AND** command inventory sections are injected from dynamic metadata

### Requirement: Skill install prerequisite visibility
Generated skill documents SHALL display installation prerequisite as a prominent fixed rule.

#### Scenario: skill document prerequisite block
- **WHEN** generated skill document is rendered
- **THEN** it includes `pip3 install cz-cli  # Must be installed to use this skill` in a high-visibility section near the top
- **AND** this prerequisite line is not removed by dynamic command generation

### Requirement: Stable generated skill output
The system SHALL generate deterministic skill command output for the same command tree.

#### Scenario: unchanged command tree
- **WHEN** command definitions do not change between runs
- **THEN** generated skill command inventory is byte-stable (except allowed timestamps/version fields)

### Requirement: Skill version identification
Generated skill documents SHALL include machine-readable version identification.

#### Scenario: generated skill metadata
- **WHEN** skill file is generated
- **THEN** output includes at least CLI version and generator version identifiers
- **AND** metadata can be used to trace which generator produced the file

### Requirement: Packaging-time skill generation
Build/packaging workflow SHALL generate skill documents before packaging artifacts.

#### Scenario: build package contains fresh generated skill
- **WHEN** release build or packaging command runs
- **THEN** skill generation step executes before artifact creation
- **AND** packaged skill document reflects current command metadata and version identifiers

### Requirement: Drift detection for skill command docs
The system SHALL provide validation that generated skill command inventory matches current CLI commands.

#### Scenario: stale committed skill inventory
- **WHEN** committed skill command section is out of sync with generated output
- **THEN** validation fails with actionable diff information

### Requirement: install-skills compatibility with dynamic skill generation
The `install-skills` command SHALL remain compatible after dynamic skill generation is introduced.

#### Scenario: install-skills on generated skill artifact
- **WHEN** user runs `cz-cli install-skills` against a build that uses generated skills
- **THEN** installation succeeds with existing user-facing workflow
- **AND** installer can resolve generated skill files from supported packaged paths
