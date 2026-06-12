## Why

OpenCode is an open-source AI coding agent with a rich TUI. We are forking it to create **czagent** — a ClickZetta Lakehouse-branded AI coding assistant. The current UI carries OpenCode's visual identity (animated logo, "opencode" naming, Go/Zen subscription upsells). To ship czagent as a ClickZetta product we need to strip the OpenCode visual brand and apply ClickZetta design language, while keeping the fork easy to merge with upstream.

## What Changes

- Replace the OpenCode animated ASCII logo with a static czagent text banner
- Replace user-facing "opencode" / "OpenCode" text with "czagent" / "CZAgent" **in the TUI layer only**
- Remove the ornate logo animation system (`logo.tsx`) and replace with a minimal static brand mark
- Strip OpenCode commercial dialogs (Go upsell, console org) — **delete only, no replacement; leave TODO comments for future CZ equivalents**
- Add a new `czagent.json` default theme with ClickZetta brand colors
- Update home screen placeholders and tips to reference ClickZetta Lakehouse
- Update CLI wordmark in `cli/ui.ts`
- **Preserve** all structural UI features: sidebar (files/todo/MCP/LSP), Tab agent switching, keybinds, plugin slots — only strip OpenCode visual branding from them

### Explicitly NOT changed (merge-friendly)
- npm package name (`opencode-ai`), config file paths (`~/.opencode/`), env vars (`OPENCODE_*`)
- TUI config schema field names
- Plugin slot names and contracts
- Desktop app, web share UI, server/backend code
- Agent system, tools, providers, session management
- Share functionality (kept as-is for now)

## Capabilities

### New Capabilities
- `czagent-branding`: User-facing text replacement (logo, wordmark, error messages, startup text) — TUI layer only, no path/env changes
- `czagent-theme`: New default theme file with ClickZetta colors; existing themes remain available
- `czagent-home-screen`: Home screen visual rebrand — static logo, CZ placeholders/tips, CZ footer text
- `czagent-session-chrome`: Visual-only rebrand of session footer, sidebar headers, permission prompts — no structural changes
- `czagent-config`: Default theme value change; startup loading text; version display prefix

### Modified Capabilities

## Impact

- **TUI component layer** (`packages/opencode/src/cli/cmd/tui/`): Targeted text/color changes in `component/logo.tsx`, `routes/home.tsx`, `feature-plugins/home/`, `routes/session/footer.tsx`
- **Theme system** (`context/theme/`): One new JSON file, one default-value change
- **CLI entry** (`cli/ui.ts`): Wordmark replacement
- **Deleted files**: `dialog-go-upsell.tsx`, `dialog-console-org.tsx` (with TODO stubs)
- **No backend/server/path/env changes** — minimizes merge conflicts with upstream
