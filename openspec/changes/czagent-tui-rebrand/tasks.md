## 1. Brand Constants Foundation

- [x] 1.1 Create `packages/opencode/src/cli/cmd/tui/brand.ts` exporting `Brand.name`, `Brand.display`, `Brand.company` constants
- [x] 1.2 Update `packages/opencode/src/cli/ui.ts` — replace the `wordmark` array to render "czagent" instead of "opencode"

## 2. Theme (additive only)

- [x] 2.1 Create `packages/opencode/src/cli/cmd/tui/context/theme/czagent.json` with ClickZetta brand colors (primary `#1677FF`, dark bg `#0D1117`, cool gray neutrals)
- [x] 2.2 Change default theme string from `"opencode"` to `"czagent"` in `packages/opencode/src/cli/cmd/tui/context/theme.tsx` (one-line change)

## 3. Home Screen (text-only changes, preserve layout)

- [x] 3.1 Replace `Logo` component body in `packages/opencode/src/cli/cmd/tui/component/logo.tsx` with static "czagent" text banner — keep file name and export name identical
- [x] 3.2 Update placeholder arrays in `packages/opencode/src/cli/cmd/tui/routes/home.tsx` to czagent-relevant suggestions
- [x] 3.3 Update version display text in `packages/opencode/src/cli/cmd/tui/feature-plugins/home/footer.tsx` to use brand constants
- [x] 3.4 Update tip content strings in `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips.tsx` and `tips-view.tsx` to reference ClickZetta Lakehouse

## 4. Remove OpenCode Commercial Features (delete + TODO stubs)

- [x] 4.1 Delete `packages/opencode/src/cli/cmd/tui/component/dialog-go-upsell.tsx` and remove imports; leave `// TODO(czagent): Add ClickZetta subscription dialog` in `app.tsx`
- [x] 4.2 Delete `packages/opencode/src/cli/cmd/tui/component/dialog-console-org.tsx` and remove imports; leave `// TODO(czagent): Add ClickZetta org picker` in `app.tsx`

## 5. Session Chrome (visual-only, no structural changes)

- [x] 5.1 Remove "Get started /connect" welcome message in `packages/opencode/src/cli/cmd/tui/routes/session/footer.tsx`
- [x] 5.2 Replace any user-visible "opencode" strings in session TUI files with brand constants (grep audit)

## 6. Startup Text

- [x] 6.1 Update loading text in `packages/opencode/src/cli/cmd/tui/component/startup-loading.tsx` to reference "czagent"

## 7. Final Audit

- [x] 7.1 Run `grep -rn "opencode\|OpenCode" packages/opencode/src/cli/cmd/tui/ packages/opencode/src/cli/ui.ts` — fix remaining user-visible references only (skip import paths, internal identifiers)
- [x] 7.2 Verify the TUI launches and visually confirm no OpenCode branding in home screen, session view, footer, and dialogs
