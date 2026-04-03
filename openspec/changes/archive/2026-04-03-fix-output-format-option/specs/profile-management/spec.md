## MODIFIED Requirements

### Requirement: Profile listing
The system SHALL display all configured profiles with their connection details (excluding passwords). The command SHALL accept `--output/-o` for output format.

#### Scenario: List profiles
- **WHEN** user runs `clickzetta profile list`
- **THEN** system displays all profiles with username, service, instance, workspace

#### Scenario: List profiles with output format
- **WHEN** user runs `clickzetta profile list -o table`
- **THEN** system displays all profiles in table format

#### Scenario: List profiles when none exist
- **WHEN** user runs `clickzetta profile list` and no profiles configured
- **THEN** system returns empty list with ok=true

### Requirement: Profile creation
The system SHALL allow users to create named connection profiles. The command SHALL accept `--output/-o` for output format.

#### Scenario: Create profile with all parameters
- **WHEN** user runs `clickzetta profile create myprofile --username user --password pass --instance inst --workspace ws`
- **THEN** system creates profile in ~/.clickzetta/profiles.toml

### Requirement: Profile selection
The system SHALL allow users to set a default profile. The command SHALL accept `--output/-o` for output format.

#### Scenario: Set default profile
- **WHEN** user runs `clickzetta profile use myprofile`
- **THEN** system sets myprofile as default

### Requirement: Profile update
The system SHALL allow users to update individual fields of an existing profile. The command SHALL accept `--output/-o` for output format.

#### Scenario: Update profile field
- **WHEN** user runs `clickzetta profile update myprofile password newpass`
- **THEN** system updates only the password field

### Requirement: Profile deletion
The system SHALL allow users to delete profiles. The command SHALL accept `--output/-o` for output format.

#### Scenario: Delete profile
- **WHEN** user runs `clickzetta profile delete myprofile`
- **THEN** system removes myprofile from profiles.toml
