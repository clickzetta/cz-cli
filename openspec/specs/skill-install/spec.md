# skill-install Specification

## Purpose
Defines how cz-cli distributes its bundled skills during install/update:

1. **Built-in skills** (builtin) — discovered by cz-cli's own agent kernel, installed to `~/.clickzetta/skills/.builtin/`.

External AI coding assistants (Claude Code, Cursor, Codex, etc.) are **no longer** integrated with cz-cli through auto-installed skills; they now integrate via MCP — the user runs `cz-cli mcp init` to register cz-cli as an MCP server. The install entry points no longer write a `cz-cli` skill into external agent skill directories, and are only responsible for cleaning up legacy leftovers (see the "Clean up legacy skills in external agent directories" requirement).

This specification covers three install entry points: npm `postinstall.js`, `scripts/install.sh` (curl install), and `scripts/setup.sh` (manual/archive install). `cz-cli update` does not distribute skills directly; instead it inherits the above behavior by re-running install.sh or the package manager (which triggers `postinstall.js`).

## Terminology
- **Bundled skill source directory**: the `skills/` directory in the install medium that contains each skill subdirectory (each subdirectory holds a `SKILL.md`). `build.ts` bundles the repository's `skills/*` into each platform artifact's `bin/skills/`.
- **Archive root directory**: the top-level directory after extracting a GitHub Release platform archive. All platform archives should directly contain the binary, `setup.sh` (where applicable), and `skills/`, without an extra wrapping `bin/` directory.
- **External agent skill directories** (used only for cleanup):
  - `~/.claude/skills`
  - `~/.agents/skills`
  - `~/.kiro/skills`
  - `~/.cursor/skills`
  - `~/.codex/skills`
  - `~/.openclaw/workspace/skills`
  - `~/.singclaw/workspace/skills`
- **Skills to be cleaned up**: `cz-cli` and the historical aliases `czagent`, `czcli`, `cz-cli-v2`.

## Requirements
### Requirement: Built-in skills installed to .builtin (behavior unchanged)

This requirement MUST be satisfied per the following scenarios.

On every install/update, all install entry points should first entirely clear `~/.clickzetta/skills/.builtin/`, then repopulate it with all bundled skills. This behavior is not affected by the external agent registration logic.

#### Scenario: Repopulate built-in skills after clearing

- **WHEN** the bundled skill source directory exists in the install medium, and `~/.clickzetta/skills/.builtin/` contains skills left over from a previous install
- **THEN** `.builtin/` is entirely cleared and contains only all of this install's bundled skills (leftover skills are no longer retained)

#### Scenario: Built-in directory is still cleared when no bundled skills exist

- **WHEN** no bundled skills exist in the install medium
- **THEN** `~/.clickzetta/skills/.builtin/` still exists and is cleared, with no stale skills remaining

#### Scenario: Windows Release archive keeps top-level skills

- **WHEN** building the Windows Release zip archive, and the platform dist's `bin/skills/cz-cli/SKILL.md` already exists
- **THEN** extracting that zip yields `skills/cz-cli/SKILL.md` directly at the top level, and install.sh, setup.sh, and the npm publish preparation scripts can all discover the bundled skill under the same directory structure

#### Scenario: Windows npm platform package includes bundled skills

- **WHEN** the npm publish script processes the `cz-cli-windows-x64` artifact and `bin/skills/cz-cli/SKILL.md` exists in the artifact
- **THEN** the generated `@clickzetta/cz-cli-win32-x64` platform package contains the same bundled skill at `bin/skills/cz-cli/SKILL.md`, and postinstall can install the `.builtin` built-in skills

#### Scenario: Windows PowerShell native install of built-in skills

- **WHEN** the user runs the COS-published `install.ps1` in a native Windows PowerShell/CMD environment, and the downloaded archive contains a top-level `skills/` directory
- **THEN** the PowerShell installer, without relying on `setup.sh` or bash, also clears and repopulates `$HOME/.clickzetta/skills/.builtin/`

### Requirement: Clean up legacy skills in external agent directories (no longer registered)

This requirement MUST be satisfied per the following scenarios.

The install entry points **no longer** register the `cz-cli` skill into external agent skill directories (external integration now goes through MCP via `cz-cli mcp init`). Instead, each install entry point should delete the skills in the cleanup list (`cz-cli` and the historical aliases `czagent`, `czcli`, `cz-cli-v2`) from all external agent skill directories, and rewrite no skills. This cleanup must be idempotent, and a failure on a single directory should not interrupt the remaining directories or the overall install flow.

#### Scenario: Delete the cz-cli skill and deprecated aliases in external directories

- **WHEN** any install entry point runs and an external agent directory contains `cz-cli` or `czagent` / `czcli` / `cz-cli-v2`
- **THEN** those skills are deleted and are not recreated; no `cz-cli` is written to any external agent directory

#### Scenario: No error when an external directory does not exist

- **WHEN** the user has not installed a given agent (its corresponding skill directory does not exist)
- **THEN** the install entry point skips that directory, does not create it, and does not error because of its absence

#### Scenario: A single directory failure does not affect the whole

- **WHEN** cleaning up a given external agent directory fails due to permissions or similar reasons
- **THEN** the cleanup of the remaining external agent directories continues, and the entire install/update flow is not interrupted (npm postinstall does not cause `npm install` to fail)

#### Scenario: Windows PowerShell native cleanup of external agent skills

- **WHEN** the user runs the COS-published `install.ps1` in a native Windows PowerShell/CMD environment
- **THEN** the PowerShell installer, without relying on `setup.sh` or bash, also deletes `cz-cli` and the deprecated aliases from all external agent skill directories, and does not re-register them

### Requirement: The update command inherits the install entry points' skill distribution behavior

This requirement MUST be satisfied per the following scenarios.

`cz-cli update` should not implement skill distribution logic on its own. It completes the upgrade by re-running install.sh (for the curl install method) or the package manager's upgrade command (for the npm/bun/pnpm/yarn install methods, which triggers `postinstall.js`), thereby automatically inheriting the built-in skill installation and external agent directory cleanup behavior.

#### Scenario: Update via the curl install method

- **WHEN** the install method is `curl` and `cz-cli update` runs
- **THEN** the re-run install.sh performs both the `.builtin` built-in skill installation and the cleanup of legacy skills in external agent directories

#### Scenario: Update via the package manager install method

- **WHEN** the install method is npm/bun/pnpm/yarn and `cz-cli update` runs
- **THEN** the package manager reinstall triggers `postinstall.js`, performing both the `.builtin` built-in skill installation and the cleanup of legacy skills in external agent directories
