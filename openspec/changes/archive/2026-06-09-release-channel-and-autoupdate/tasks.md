## 1. Release channel resolution (isolated)

- [x] 1.1 Add `ReleaseChannel` type + `DEFAULT_RELEASE_CHANNEL = "stable"` in `bootstrap.ts`
- [x] 1.2 Add `coerceChannel` (legacy/unknown → undefined) and `resolveReleaseChannel` (`CZ_CHANNEL` → `install.json.channel` → `stable`)
- [x] 1.3 Remove `InstallationChannel` import/usage from `bootstrap.ts`

## 2. De-gate auto-update from channel

- [x] 2.1 Remove channel gate and unused `channel?` field from `shouldSkipAutoUpdateCommand`
- [x] 2.2 Remove `channel !== "nightly"` skip from `resolveUpdateAction` (keep `channel` in input type)
- [x] 2.3 `maybeAutoUpdate`: resolve release channel and pass it to `latestVersionForMethod`, `resolveUpdateAction`, and `performUpgrade`

## 3. Persist channel without coupling

- [x] 3.1 `writeInstallMetadata`: preserve existing `install.json` channel (default `stable`); stop writing `InstallationChannel`
- [x] 3.2 `cz-cli update` (`update.ts`): resolve channel via `resolveReleaseChannel()`; drop unused `readInstallMetadata` import

## 4. Unify install entry points

- [x] 4.1 `setup.sh`: default `CZ_CHANNEL` from `latest` → `stable`
- [x] 4.2 npm `postinstall.js`: write `channel: "stable"` (was `latest`)
- [x] 4.3 `scripts/install.sh`: write `~/.clickzetta/install.json` with channel (`${CZ_CHANNEL:-stable}`), `installed_path`, `binary_version`, `updated_at`

## 5. Tests and verification

- [x] 5.1 Add `resolveReleaseChannel` tests (default stable, install.json read, `CZ_CHANNEL` override, legacy `latest` → stable)
- [x] 5.2 Add channel-not-gating tests (`resolveUpdateAction` upgrades on stable; `shouldSkipAutoUpdateCommand` does not skip a real install, skips invalid semver)
- [x] 5.3 Add `setup.sh` install.json contract test (stable default + `CZ_CHANNEL=nightly` override)
- [x] 5.4 Run `bun typecheck` (opencode + cz-cli) and update/install test suites; confirm shell syntax (`bash -n` / `sh -n`) and `node --check`
