## Context

cz-cli is built on opencode. opencode injects a build-time `InstallationChannel` constant (`CLICKZETTA_CHANNEL`) that is deeply wired into the runtime: per-channel SQLite DB isolation (`getChannelPath()`), OpenTelemetry `deployment.environment.name`, `USER_AGENT`, and dev-mode detection (`isLocal()`/`isPreview()`, plugin version pinning). The update logic reused this same constant to decide the release stream and to gate auto-update, and the gate required `channel === "nightly"`. As a result, `stable` installs never auto-updated, and a channel rename in an unrelated commit silently regressed the behavior.

Separately, channel values were inconsistent across install paths (`latest` in npm postinstall and `setup.sh` default; `stable` in the COS bootstrap; `nightly` for dev), and `scripts/install.sh` did not write `~/.clickzetta/install.json` at all, so the installed channel could not be recovered by `cz-cli update`.

## Goals / Non-Goals

**Goals:**
- A dedicated cz-cli "release channel" concept, fully isolated from opencode's `InstallationChannel`.
- Auto-update works for the normal (`stable`) release, not just `nightly`.
- One consistent channel vocabulary (`stable` default, `nightly`) and one consistent `install.json` schema written by every install/update entry point.
- Make the invariants testable so future renames cannot silently regress behavior.

**Non-Goals:**
- Changing opencode's `InstallationChannel` or any of its consumers (DB path, telemetry, dev detection, plugin pinning).
- Adding new channels beyond `stable`/`nightly`.
- Changing how install scripts are generated/served (COS bootstrap, GitHub installer); only the metadata they persist and their default channel.

## Decisions

**D1 — Separate release channel, not a reuse of `InstallationChannel`.**
The release channel is resolved at runtime from `CZ_CHANNEL` env → `~/.clickzetta/install.json` `channel` → `stable`. The persisted channel is authored by the installer that performed the install (it knows the stream), and read back by update/auto-update. Rationale: `InstallationChannel` carries unrelated runtime semantics (data isolation, telemetry env); coupling release decisions to it caused the regression and risked cross-effects. Alternative considered: add a second build-time constant — rejected because the installer, not the binary build, is the authority for "which stream is this machine tracking," and it must survive binary replacement.

**D2 — Channel selects the stream; it does not gate whether auto-update runs.**
Auto-update enablement is decided by: not disabled via env/config, command not in skip-list (`setup`/`update`/`uninstall`/`--help`/`--version`), `semver.valid(version)` (excludes dev/local builds), supported install method, and the check interval. Channel only maps to endpoints/scripts (`stable` → `api/stable` + `install.sh`; `nightly` → `api/nightly` + `install-nightly.sh`). Rationale: the previous channel gate was the root cause; the dev/local guard already exists via invalid semver of `InstallationVersion === "local"`.

**D3 — `writeInstallMetadata` preserves the existing channel.**
Instead of stamping `InstallationChannel`, it reads the current `install.json`, keeps its (coerced) channel, defaulting to `stable`, and lets explicit callers override. This severs the bridge to opencode's channel while keeping the channel sticky across updates.

**D4 — Two-file state model is the contract for "did auto-update run".**
`install.json` is channel/identity memory written by every entry point. `update-check.json` (under XDG state) is written only by the auto-update path and records `last_checked_at`/`last_result`/`latest_version`. Diagnosing auto-update activity uses `update-check.json`, never `install.json.updated_at` (which a manual update also bumps).

**D5 — Unify channel vocabulary and `install.json` schema.**
All writers emit `{ version: 1, installed_path, channel, binary_version, updated_at }`; `version` is the metadata schema version (distinct from `binary_version`). Defaults unified to `stable`; legacy `latest` coerces to `stable` on read.

## Risks / Trade-offs

- [Existing `install.json` with `channel: "latest"` from older npm installs] → `coerceChannel` maps unknown values to `stable`, so they transparently behave as stable; no migration needed.
- [`stable` users who never auto-updated now will] → intended fix; bounded by the same env/config opt-outs (`CLICKZETTA_DISABLE_AUTOUPDATE`, `autoupdate: false`, `CZ_SKIP_UPDATE`) and the check interval.
- [Installer is the channel authority, but a fresh install before first `cz-cli update` may lack `install.json`] → resolution defaults to `stable`; every installer now writes `install.json`, so this window is minimal.
- [Drift between the five writers] → mitigated by tests: `setup.sh` install.json contract test, bootstrap channel-resolution and channel-not-gating tests; the COS bootstrap `CHANNEL="stable"` assertion already exists.

## Migration Plan

1. Land code/scripts together (single change); no data migration required.
2. Existing `install.json` files are read-compatible (legacy `latest` → `stable`).
3. Rollback: revert the change; auto-update returns to nightly-only behavior. No persisted-state cleanup needed (schema `version` unchanged).

## Open Questions

- Should `nightly` ever be surfaced to end users, or remain dev-only? Current decision: dev-only stream, `stable` is the default for all user-facing installs.
