# release-channel Specification

## Purpose
Defines cz-cli's release channel (`stable`/`nightly`): its allowed values and default, resolution precedence, isolation from opencode's `InstallationChannel`, and the `install.json` schema that every install/update entry point must persist.
## Requirements
### Requirement: Release channel is isolated from opencode InstallationChannel

cz-cli SHALL maintain a release channel concept that is separate from opencode's build-time `InstallationChannel` constant. The release channel MUST NOT be derived from `InstallationChannel`, and the update subsystem MUST NOT read `InstallationChannel` to determine the release stream. opencode's `InstallationChannel` and its consumers (per-channel DB path, telemetry `deployment.environment.name`, `isLocal()`/`isPreview()`, plugin version pinning) MUST remain unaffected.

#### Scenario: Update subsystem does not reference InstallationChannel

- **WHEN** the update/auto-update code resolves the release channel
- **THEN** the value is computed from `CZ_CHANNEL`, `install.json`, or the default, and not from `InstallationChannel`

#### Scenario: opencode channel consumers unchanged

- **WHEN** the release channel changes between `stable` and `nightly`
- **THEN** the SQLite DB path, telemetry environment, and dev-mode detection derived from `InstallationChannel` are unchanged

### Requirement: Allowed channel values and default

The release channel SHALL be one of `stable` or `nightly`. `stable` SHALL be the default for all user-facing installs. Unknown or legacy values (for example `latest`) SHALL coerce to `stable` when read.

#### Scenario: Unknown value coerces to stable

- **WHEN** `install.json` contains `"channel": "latest"`
- **THEN** the resolved release channel is `stable`

#### Scenario: Default when unset

- **WHEN** no `CZ_CHANNEL` env is set and `install.json` has no usable channel
- **THEN** the resolved release channel is `stable`

### Requirement: Channel resolution precedence

The release channel SHALL be resolved with the precedence: `CZ_CHANNEL` environment variable, then `~/.clickzetta/install.json` `channel`, then `stable`.

#### Scenario: Env overrides install.json

- **WHEN** `install.json` has `"channel": "nightly"` and `CZ_CHANNEL=stable` is set
- **THEN** the resolved release channel is `stable`

#### Scenario: install.json used when env unset

- **WHEN** `CZ_CHANNEL` is unset and `install.json` has `"channel": "nightly"`
- **THEN** the resolved release channel is `nightly`

### Requirement: install.json schema and persistence contract

Every install or update entry point — the bundled `setup.sh`, `scripts/install.sh`, the npm `postinstall.js`, the `cz-cli update` command, and the automatic update path — SHALL create or update `~/.clickzetta/install.json`. The file SHALL contain `version` (metadata schema version, currently `1`), `installed_path`, `channel`, `binary_version`, and `updated_at`. The `version` field is the metadata schema version and is distinct from `binary_version` (the cz-cli program version); changing the file structure SHALL bump `version`.

#### Scenario: setup.sh persists the channel

- **WHEN** `setup.sh` runs with `CZ_VERSION` set and no `CZ_CHANNEL`
- **THEN** `install.json` is written with `channel` = `stable` and `binary_version` = the installed version

#### Scenario: CZ_CHANNEL override persisted

- **WHEN** `setup.sh` runs with `CZ_CHANNEL=nightly`
- **THEN** `install.json` is written with `channel` = `nightly`

#### Scenario: An updated channel is preserved across writes

- **WHEN** `writeInstallMetadata` is called and `install.json` already has a `channel`
- **THEN** the existing channel is retained unless an explicit channel is provided, and never replaced by `InstallationChannel`

