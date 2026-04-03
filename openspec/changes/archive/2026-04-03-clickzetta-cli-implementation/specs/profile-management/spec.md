## ADDED Requirements

**Configuration File**: ~/.clickzetta/profiles.toml (TOML format)


### Requirement: Profile creation
The system SHALL allow users to create named connection profiles with all required ClickZetta connection parameters.

#### Scenario: Create profile with all parameters
- **WHEN** user runs `clickzetta profile create myprofile --username user --password pass --instance inst --workspace ws --service dev-api.clickzetta.com --schema public --vcluster default`
- **THEN** system creates profile in ~/.clickzetta/profiles.toml with all parameters

#### Scenario: Create profile with missing required parameter
- **WHEN** user runs `clickzetta profile create myprofile --username user` without password
- **THEN** system returns error "Password is required"

### Requirement: Profile listing
The system SHALL display all configured profiles with their connection details (excluding passwords).

#### Scenario: List profiles
- **WHEN** user runs `clickzetta profile list`
- **THEN** system displays all profiles with username, service, instance, workspace

#### Scenario: List profiles when none exist
- **WHEN** user runs `clickzetta profile list` and no profiles configured
- **THEN** system returns empty list with ok=true

### Requirement: Profile selection
The system SHALL allow users to set a default profile for subsequent commands.

#### Scenario: Set default profile
- **WHEN** user runs `clickzetta profile use myprofile`
- **THEN** system sets myprofile as default by renaming it to "default" in profiles.toml

### Requirement: Profile update
The system SHALL allow users to update individual fields of an existing profile.

#### Scenario: Update profile field
- **WHEN** user runs `clickzetta profile update myprofile password newpass`
- **THEN** system updates only the password field in myprofile

#### Scenario: Update non-existent profile
- **WHEN** user runs `clickzetta profile update nonexistent password newpass`
- **THEN** system returns error "Profile 'nonexistent' not found"

### Requirement: Profile deletion
The system SHALL allow users to delete profiles.

#### Scenario: Delete profile
- **WHEN** user runs `clickzetta profile delete myprofile`
- **THEN** system removes myprofile from profiles.toml

#### Scenario: Delete non-existent profile
- **WHEN** user runs `clickzetta profile delete nonexistent`
- **THEN** system returns error "Profile 'nonexistent' not found"
