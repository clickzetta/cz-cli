## 1. Dynamic AI Guide Metadata Pipeline

- [x] 1.1 Implement a shared command metadata builder that introspects Click command tree (path, usage, options, help, defaults).
- [x] 1.2 Refactor `cz-cli ai-guide` to render from shared metadata and remove static `_AI_GUIDE` command inventory from `cz_cli/main.py`.
- [x] 1.3 Add ai-guide length budget policy (mandatory sections retained, low-priority sections trimmed, truncation metadata exposed).

## 2. Skill Document Dynamic Generation

- [x] 2.1 Define a fixed SKILL template contract (static descriptive sections) and dynamic command inventory insertion points.
- [x] 2.2 Implement generator to render `cz_cli/skills/cz-cli/SKILL.md` command sections from shared metadata.
- [x] 2.3 Add drift check to detect mismatch between generated skill command inventory and committed file.

## 3. Consistency, Tests, and Validation

- [x] 3.1 Add tests verifying command signature consistency across `--help`, `ai-guide`, and generated skill inventory.
- [x] 3.2 Add tests for budget behavior (no truncation under budget, deterministic truncation with required-section preservation over budget).
- [x] 3.3 Update/refresh integration fixtures or snapshots affected by dynamic ai-guide/skill output.

## 4. Delivery Hygiene

- [x] 4.1 Update CHANGELOG.md with the dynamic-generation change and backward-compatibility notes.
- [x] 4.2 Run `make lint` and fix any issues.
- [ ] 4.3 Run `make test` (and targeted integration checks if needed) and ensure green before merge.

### Notes

- `make test` fails in the current environment because Studio integration cannot resolve `dev-api.clickzetta.com` (DNS/network issue), while unit tests are green.
