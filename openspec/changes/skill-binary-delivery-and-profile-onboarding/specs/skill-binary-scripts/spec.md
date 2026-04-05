## ADDED Requirements

### Requirement: Build script copies binary into skill scripts directory
`build_fat_multi_platform.sh` SHALL copy the built binary into `cz_cli/skills/cz-cli/scripts/<platform>-<arch>/cz-cli[.exe]` after each successful build.

#### Scenario: Binary placed in skill scripts directory after build
- **WHEN** `build_fat_multi_platform.sh` completes a successful build for a platform
- **THEN** the binary is copied to `cz_cli/skills/cz-cli/scripts/<platform>-<arch>/cz-cli` (or `.exe` on Windows)
- **AND** the directory is created if it does not exist
- **AND** the existing dist output path remains unchanged (backward compatible)

#### Scenario: Scripts directory structure follows platform naming convention
- **WHEN** binary is placed in the scripts directory
- **THEN** the subdirectory name matches `${PLATFORM_TAG}-${ARCH_TAG}` (e.g., `macos-arm64`, `linux-x86_64`)
- **AND** the binary filename is `cz-cli` (or `cz-cli.exe` on Windows)

### Requirement: Binary files excluded from git, directory structure committed
The `scripts/` directory SHALL have its binary contents excluded from version control, but the directory structure SHALL be preserved.

#### Scenario: .gitignore excludes binaries in scripts subdirectories
- **WHEN** a binary is placed in `cz_cli/skills/cz-cli/scripts/<platform>/cz-cli`
- **THEN** `git status` does not show the binary as an untracked or modified file
- **AND** a `.gitkeep` or `README` placeholder in `cz_cli/skills/cz-cli/scripts/` IS committed

### Requirement: install-skills copies scripts directory when present
The `install-skills` command SHALL include the `scripts/` subdirectory when copying a skill to the target tool directory.

#### Scenario: Install includes binary scripts when present
- **WHEN** user runs `cz-cli install-skills` and selects the cz-cli skill
- **AND** `cz_cli/skills/cz-cli/scripts/` contains platform-specific binary subdirectories
- **THEN** the installed skill directory includes the `scripts/` directory and its contents
- **AND** existing `shutil.copytree` behavior already handles this (no special logic needed if `scripts/` is inside skill dir)

#### Scenario: Install succeeds even when scripts directory is empty
- **WHEN** user runs `cz-cli install-skills` and the `scripts/` directory has no binaries (dev environment)
- **THEN** installation succeeds without error
- **AND** installed skill contains an empty `scripts/` directory or the `.gitkeep` placeholder only
