# auto-update Specification

## Purpose
Defines when cz-cli updates itself automatically, how the release channel selects the update stream (version source and install mechanism), the two-file update state model, and notify-versus-upgrade behavior.
## Requirements
### Requirement: Auto-update is not gated by channel

Auto-update SHALL run for any real install regardless of release channel. Enablement SHALL be determined by: the update not being disabled (via config `autoupdate: false` or env `CLICKZETTA_DISABLE_AUTOUPDATE` / `CZ_SKIP_UPDATE` / one-shot `CLICKZETTA_SKIP_UPDATE_ONCE`), the command not being in the skip list (`setup`, `update`, `uninstall`, `--help`/`-h`, `--version`/`-v`), the installed version being valid semver, a supported install method, and the check interval having elapsed. The channel value SHALL NOT decide whether auto-update runs.

#### Scenario: Stable install upgrades

- **WHEN** a `stable` install has a supported method, a valid current version, an available newer version, and the interval has elapsed
- **THEN** the resolved action is `upgrade`

#### Scenario: Dev/local builds are skipped

- **WHEN** the installed version is not valid semver (for example a `local` dev build)
- **THEN** auto-update is skipped

#### Scenario: Real install is not skipped on any channel

- **WHEN** the command is a normal command, no skip env is set, and the version is valid semver
- **THEN** auto-update is not skipped, independent of the channel

### Requirement: Channel selects the update stream; method never selects the version

The release channel SHALL be the sole source of the target version, always resolved from cz-cli.ai: `stable` from `https://cz-cli.ai/api/stable`, `nightly` from `https://cz-cli.ai/api/nightly`. The install method SHALL NOT influence version resolution — it only selects the upgrade mechanism (`stable` → `install.sh`; `nightly` → `install-nightly.sh`; managed package managers use their own install command). In particular, version resolution SHALL NOT query the npm registry's `latest` dist-tag, even when the install method is npm/pnpm/yarn/bun. Both `stable` and `nightly` are eligible for automatic upgrade.

#### Scenario: Stable stream endpoints

- **WHEN** the release channel is `stable`
- **THEN** the latest version is fetched from `https://cz-cli.ai/api/stable` and upgrades use the stable install script

#### Scenario: Nightly stream endpoints

- **WHEN** the release channel is `nightly`
- **THEN** the latest version is fetched from `https://cz-cli.ai/api/nightly` and upgrades use the nightly install script

#### Scenario: npm install method does not change the version source

- **WHEN** the install method is npm/pnpm/yarn/bun on the `stable` channel
- **THEN** the target version is still fetched from `https://cz-cli.ai/api/stable` and the npm registry is not queried for version resolution

#### Scenario: npm lacks the resolved version

- **WHEN** the channel-resolved version is not yet published to the npm registry
- **THEN** the package-manager upgrade may fail and the system falls back to the install script for that channel

### Requirement: Two-file update state model

The system SHALL maintain two distinct files. `~/.clickzetta/install.json` is channel/identity memory written by every install and update entry point. `~/.local/state/clickzetta/update-check.json` (XDG state) SHALL be written ONLY by the automatic update path and SHALL record `last_checked_at`, `last_result`, and `latest_version`. Determining whether an automatic update occurred SHALL rely on `update-check.json`, not on `install.json.updated_at`.

#### Scenario: Manual update does not write the auto-update state file

- **WHEN** the user runs `cz-cli update`
- **THEN** `install.json` is updated but `update-check.json` is not written

#### Scenario: Auto-update records its activity

- **WHEN** the automatic update path performs a check
- **THEN** `update-check.json` is written with `last_checked_at` and a `last_result`

### Requirement: Notify versus upgrade

When a newer version is available, the system SHALL perform an automatic in-place upgrade if the install method is one of the supported managed methods (`curl`, `npm`, `pnpm`, `yarn`, `bun`) and autoupdate is enabled; otherwise it SHALL notify the user that an update is available.

#### Scenario: Unsupported method notifies

- **WHEN** a newer version is available but the install method is unsupported
- **THEN** the resolved action is `notify`

#### Scenario: Notify-only configuration

- **WHEN** `autoupdate` is configured to `notify`
- **THEN** the user is informed of the available update and no automatic upgrade is performed

