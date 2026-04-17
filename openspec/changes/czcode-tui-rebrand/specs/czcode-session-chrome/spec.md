## ADDED Requirements

### Requirement: Session UI structure SHALL be fully preserved
The sidebar (files, todo, context, MCP, LSP panels), Tab agent switching, keybinds, and all session layout SHALL remain unchanged. Only user-visible "opencode" text strings and theme colors change.

#### Scenario: Sidebar panels are intact
- **WHEN** the user opens the sidebar in a session
- **THEN** all panels (files, todo, context, MCP, LSP) are present and functional

#### Scenario: Tab agent switching works
- **WHEN** the user presses Tab to switch agents
- **THEN** agent switching works identically to upstream OpenCode

### Requirement: Session footer SHALL not display OpenCode-specific messages
The "Get started /connect" welcome message SHALL be removed. Any user-visible "opencode" text in the session footer SHALL be replaced with czcode branding.

#### Scenario: No welcome message in session footer
- **WHEN** the user enters a session without a connected provider
- **THEN** the footer does not display "Get started /connect"

### Requirement: Session chrome colors SHALL come from theme
Session footer, sidebar, and permission prompt colors SHALL be determined by the active theme. No per-component color overrides SHALL be added for the rebrand.

#### Scenario: Theme change applies globally
- **WHEN** the czcode theme is active
- **THEN** all session chrome elements use the czcode theme colors without per-file color changes
