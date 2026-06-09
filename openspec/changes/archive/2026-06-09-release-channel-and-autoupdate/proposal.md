## Why

cz-cli's auto-update silently stopped working for `stable` users: the update logic was gated to only run on the `nightly` channel, and it reused opencode's build-time `InstallationChannel` constant — which is also wired into per-channel DB isolation, telemetry, and dev-mode detection. Channel naming was inconsistent (`latest` / `stable` / `nightly`) across install paths, and `scripts/install.sh` never wrote the `install.json` metadata at all, so the channel a user installed could not be reliably recovered. This made the behavior fragile and easy to break unknowingly (a single rename regressed it).

## What Changes

- Introduce a dedicated **release channel** concept for cz-cli, isolated from opencode's `InstallationChannel`. Values: `stable` (default) and `nightly`. Resolution order: `CZ_CHANNEL` env → `~/.clickzetta/install.json` `channel` → `stable`. Unknown/legacy values (e.g. `latest`) coerce to `stable`.
- **BREAKING (behavioral)**: Auto-update is no longer gated by channel. It runs for any real install (valid semver version + supported install method), on both `stable` and `nightly`. Channel only selects the update stream (`stable` → `api/stable` + `install.sh`; `nightly` → `api/nightly` + `install-nightly.sh`). Dev/local builds remain excluded via the existing `semver.valid(version)` guard.
- Stop deriving/writing the persisted channel from `InstallationChannel`; `writeInstallMetadata` now preserves the existing `install.json` channel (default `stable`).
- All install/update entry points MUST create-or-update `~/.clickzetta/install.json` with the channel: `setup.sh`, `scripts/install.sh`, npm `postinstall.js`, `cz-cli update`, and auto-update. Defaults unified to `stable`.
- Define the two-file state model as a contract: `install.json` (channel memory, written by every entry point) vs `update-check.json` (auto-update activity log, written only by the auto-update path).

## Capabilities

### New Capabilities
- `release-channel`: The cz-cli release-channel concept — allowed values, resolution precedence, isolation from opencode's `InstallationChannel`, the `install.json` schema/contract, and the requirement that every install/update entry point persists the channel.
- `auto-update`: When auto-update runs and is skipped, channel-as-stream-selector (not a gate), the two-file state model, and update vs notify behavior.

### Modified Capabilities
<!-- None: no previously archived specs exist for these capabilities. -->

## Impact

- Code: `packages/opencode/src/update/bootstrap.ts` (channel resolution, gating, metadata write), `packages/cz-cli/src/commands/update.ts` (channel resolution), `packages/npm/cz-cli/bin/postinstall.js`, `scripts/setup.sh`, `scripts/install.sh`.
- Behavior: `stable` users now receive automatic updates. nightly continues to auto-update.
- Not affected: opencode `InstallationChannel` and its consumers (per-channel DB path, OTel `deployment.environment.name`, `isLocal()`/`isPreview()`, plugin version pinning) are intentionally left unchanged.
- Env/config: new `CZ_CHANNEL` override; existing `CLICKZETTA_DISABLE_AUTOUPDATE` / `CZ_SKIP_UPDATE` / `CLICKZETTA_AUTOUPDATE` / `autoupdate` config continue to apply.
