## MODIFIED Requirements

### Requirement: Template-based skill document generation
The system SHALL support rendering skill command sections from a fixed template plus dynamic command metadata.

#### Scenario: generate skill document command inventory
- **WHEN** skill documentation is generated
- **THEN** fixed template sections remain unchanged
- **AND** command inventory sections are injected from dynamic metadata

### Requirement: Skill install prerequisite visibility
Generated skill documents SHALL describe how to invoke cz-cli, using the bundled binary from `scripts/` as the primary method and pip as fallback.

#### Scenario: skill document binary path instruction
- **WHEN** generated skill document is rendered
- **THEN** it includes a prominent section explaining that `cz-cli` binary is available in the skill's `scripts/<platform>-<arch>/` directory after installation
- **AND** it includes a fallback instruction: `pip3 install cz-cli -U` for environments where the binary is not present
- **AND** the original `pip3 install cz-cli -U  # Must be installed to use this skill` IMPORTANT block is replaced with the binary-first instruction

#### Scenario: Rule 0 present in generated SKILL.md
- **WHEN** skill file is generated from SKILL.template.md
- **THEN** Rule 0 (profile onboarding) is present in the AI Agent Behavior Rules section
- **AND** Rule 0 appears before Rule 1

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
