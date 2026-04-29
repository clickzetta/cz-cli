## Context

The OpenCode TUI is built with `@opentui/solid` (a Solid.js-based terminal rendering framework). The UI layer lives in `packages/opencode/src/cli/cmd/tui/` with a plugin-based architecture: the home screen, session view, sidebar, and footer are all composed via named slots (`home_logo`, `home_footer`, `home_prompt`, `session_prompt_right`, etc.) managed by `TuiPluginRuntime`.

This fork will track upstream OpenCode `dev` branch. **Every design decision prioritizes minimal diff to reduce merge conflicts.**

Key branding touchpoints:
- `component/logo.tsx` — 633-line animated ASCII logo
- `cli/ui.ts` — CLI wordmark for non-TUI output
- `routes/home.tsx` — Home screen layout with logo slot, prompt, footer
- `feature-plugins/home/footer.tsx` — Version, MCP status, directory
- `feature-plugins/home/tips.tsx` — Tip suggestions
- `routes/session/footer.tsx` — Session status bar
- `context/theme/opencode.json` — Default theme
- `component/dialog-go-upsell.tsx` — OpenCode Go upsell
- `component/dialog-console-org.tsx` — OpenCode console org picker

## Goals / Non-Goals

**Goals:**
- Strip OpenCode visual branding from user-facing TUI text and colors
- Keep structural UI intact (sidebar, Tab agent switch, plugin slots, keybinds)
- Minimize files changed — prefer additive changes (new theme file, new brand.ts) over rewrites
- Delete OpenCode commercial features with TODO stubs for future CZ equivalents
- Maintain easy merge path with upstream `dev` branch

**Non-Goals:**
- Changing npm package name, config paths (`~/.opencode/`), env vars (`OPENCODE_*`)
- Rewriting TUI framework, rendering engine, or plugin system
- Replacing OpenCode commercial features with ClickZetta equivalents (future work)
- Modifying agent, provider, tool, or session systems
- Redesigning desktop app or web share UI
- Removing sidebar, Tab switching, or any structural UI features

## Decisions

### D1: Replace animated logo with static text — minimal rewrite

**Decision**: Replace the body of `logo.tsx`'s `Logo` component with a static "czagent" text render. Keep the file and export name identical so `routes/home.tsx` needs zero changes to its `<Logo />` usage.

**Rationale**: Keeping the same file/export means the diff is contained to one file. Upstream changes to `home.tsx` won't conflict.

**Alternatives considered**:
- Delete `logo.tsx` entirely → Forces changes in `home.tsx` and any plugin referencing the slot, increases merge conflicts

### D2: New theme file, one-line default change

**Decision**: Add `czagent.json` theme file alongside existing themes. Change the default theme fallback from `"opencode"` to `"czagent"` — a single string change in `theme.tsx`.

**Rationale**: Additive (new file) + one-line change = minimal conflict surface. All existing themes remain untouched.

### D3: Delete commercial dialogs, leave TODO stubs

**Decision**: Delete `dialog-go-upsell.tsx` and `dialog-console-org.tsx`. In `app.tsx` where they were imported/registered, replace with `// TODO(czagent): Add ClickZetta account/subscription dialog here` comments. Do NOT build replacement features.

**Rationale**: Clean removal now, placeholder for future CZ integration. Avoids building features that aren't specced yet.

### D4: Brand constants module

**Decision**: Create `brand.ts` with:
```ts
export const Brand = {
  name: "czagent",
  display: "CZAgent",
  company: "ClickZetta",
} as const
```

Use this only in the ~5 files that have user-visible hardcoded "opencode" strings in the TUI layer. Do NOT rename internal identifiers, paths, or env vars.

**Rationale**: Centralizes the few strings that need changing. Internal code references like `@opencode-ai/plugin` stay untouched — they're not user-visible and changing them would create massive merge conflicts.

### D5: Home screen — text-only changes

**Decision**: In `routes/home.tsx`, only change:
1. Placeholder text arrays (3 strings)
2. Keep all layout, slots, and structural code identical

In `feature-plugins/home/footer.tsx`, only change the version display text.
In `feature-plugins/home/tips.tsx`, update tip content strings.

**Rationale**: Minimal line changes = easy merge. The layout is already prompt-centric.

### D6: Session chrome — visual-only, no structural changes

**Decision**: Keep sidebar (files/todo/MCP/LSP), Tab agent switching, and all session UI structure. Only change:
- Remove "Get started /connect" text in `session/footer.tsx`
- Replace any user-visible "opencode" strings with brand constants
- Colors come from theme automatically — no per-component color changes needed

**Rationale**: The session chrome is functional, not branded. Theme change handles colors globally. Structural preservation means zero merge conflicts in session code.

## Risks / Trade-offs

- **[Upstream merge — LOW]** → With this minimal approach, conflicts are limited to: `logo.tsx` (full rewrite), `app.tsx` (import removals), and one line in `theme.tsx`. All other changes are additive or string-only.
- **[Incomplete branding]** → Some deep error messages or generated text may still say "opencode". Acceptable for v1; the final audit task catches user-visible ones.
- **[Commercial feature gap]** → Deleting Go/console dialogs without replacement means czagent has no account system. TODO stubs mark where to add CZ equivalents later.
- **[Theme contrast]** → New czagent theme needs testing across terminals. Mitigation: test on iTerm2, Terminal.app, Alacritty.
