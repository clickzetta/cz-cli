## 1. Specification

- [x] 1.1 Update `openspec/specs/auto-update/spec.md` with Windows PowerShell installer compatibility and PATH registration requirements.

## 2. Tests

- [x] 2.1 Add failing tests in `packages/opencode/test/cos-release-logging.test.ts` that assert generated `install.ps1` avoids PowerShell 7-only syntax and includes legacy-safe download guidance.
- [x] 2.2 Add failing tests in `packages/opencode/test/cos-release-logging.test.ts` that assert generated `install.ps1` writes the install directory to User PATH, updates current `$env:Path`, and avoids duplicate PATH entries.

## 3. Implementation

- [x] 3.1 Update `scripts/cos-release.mjs` `renderBootstrapPs1` to emit PowerShell 5.1-safe version parsing code.
- [x] 3.2 Update `scripts/cos-release.mjs` `renderBootstrapPs1` to register the install directory in User PATH and current process PATH with duplicate detection.
- [x] 3.3 Update `scripts/cos-release.mjs` output messages to include a Windows PowerShell-compatible install command that does not rely on `irm`.

## 4. Verification

- [x] 4.1 Run the targeted Bun test file from `packages/opencode`.
- [x] 4.2 Run `bun typecheck` from `packages/opencode`.
- [x] 4.3 Run OpenSpec status/validation for `windows-powershell-installer-compat`.
