## 1. Spec And Test Alignment

- [x] 1.1 Update `openspec/specs/release-channel/spec.md` with the final metadata layout and unique pointer contract.
- [x] 1.2 Update `openspec/specs/binary-distribution/spec.md` with current-channel and historical-version manifest rules.
- [x] 1.3 Update `openspec/specs/auto-update/spec.md` so channel APIs resolve from `META-INF/versions.json`.
- [x] 1.4 Update release/promote tests in `packages/opencode/test/cos-release-logging.test.ts` and `packages/opencode/test/release-dev-format.test.ts`.
- [x] 1.5 Update website route tests in `/Users/zhanglin/IdeaProjects/cz-cli-website/src/routes/manifest-routes.test.ts`.
- [x] 1.6 Update CLI update tests in `packages/opencode/test/update/bootstrap.test.ts` and `packages/opencode/test/update/install-script-target.test.ts`.

## 2. Release Metadata Writers

- [x] 2.1 Update `scripts/cos-release.mjs` to write channel assets under `META-INF/channels/<channel>/...`.
- [x] 2.2 Update `scripts/cos-release.mjs` to use `META-INF/versions.json` as the only channel pointer and guard downgrades before channel asset writes.
- [x] 2.3 Update `scripts/cos-promote.mjs` to sync release assets into `META-INF/channels/<channel>/...`.
- [x] 2.4 Update `scripts/cos-promote.mjs` to reject downgrades based on `versions.json.<channel>` before modifying channel assets.

## 3. Website Consumers

- [x] 3.1 Update `/Users/zhanglin/IdeaProjects/cz-cli-website/src/routes/api.ts` so `/api/stable` and `/api/nightly` read `META-INF/versions.json`.
- [x] 3.2 Update `/Users/zhanglin/IdeaProjects/cz-cli-website/src/routes/install.ts` so default install reads `META-INF/channels/<channel>/bootstrap.*`.
- [x] 3.3 Update `/Users/zhanglin/IdeaProjects/cz-cli-website/src/routes/release-manifest.ts` and `manifest-path.ts` so current-channel fallback reads `META-INF/channels/<channel>/manifest.json` only when `versions.json.<channel>` matches.
- [x] 3.4 Update `/Users/zhanglin/IdeaProjects/cz-cli-website/src/routes/install.ts` so `/install.ps1?version=<version>` renders from `META-INF/releases/<version>/manifest.json`.

## 4. CLI Update Path

- [x] 4.1 Update `packages/opencode/src/update/bootstrap.ts` so Windows specified-version update downloads `/install.ps1?version=<target>`.
- [x] 4.2 Verify `packages/cz-cli/src/commands/update.ts` rejects successful installers that leave the wrong binary version before writing install metadata.

## 5. Validation

- [x] 5.1 Run website route tests, typecheck, and build from `/Users/zhanglin/IdeaProjects/cz-cli-website`.
- [x] 5.2 Run opencode focused release/update tests and typecheck from `packages/opencode`.
- [x] 5.3 Run cz-cli update tests and typecheck from `packages/cz-cli`.
- [x] 5.4 Run `openspec validate --all`.
- [x] 5.5 Smoke-test live endpoints after deployment: `/api/versions`, `/api/stable`, `/install.sh?version=1.0.18`, `/install.ps1?version=1.0.18`, and `cz-cli update -t 1.0.18`.
