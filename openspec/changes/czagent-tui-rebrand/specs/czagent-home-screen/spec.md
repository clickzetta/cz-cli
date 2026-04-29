## ADDED Requirements

### Requirement: Home screen SHALL display a static czagent brand mark
The `Logo` component in `logo.tsx` SHALL be replaced with a static "czagent" text banner. The file and export name SHALL remain identical to minimize upstream merge conflicts. No animation, glow, shimmer, or interactive effects SHALL execute.

#### Scenario: Home screen renders static brand
- **WHEN** the user is on the home screen
- **THEN** a static "czagent" text banner is displayed above the prompt

#### Scenario: Logo file and export are preserved
- **WHEN** `routes/home.tsx` imports and renders `<Logo />`
- **THEN** it works without any changes to `home.tsx`

### Requirement: Home screen layout SHALL be preserved
The home screen layout structure (logo slot, prompt, bottom slot, footer slot) SHALL NOT change. Only the content rendered within slots changes.

#### Scenario: Plugin slots are unchanged
- **WHEN** a TUI plugin registers for `home_logo`, `home_prompt`, `home_bottom`, or `home_footer` slots
- **THEN** the plugin works identically to before the rebrand

### Requirement: Home screen placeholders SHALL reflect czagent context
The prompt placeholder text arrays SHALL use czagent-appropriate suggestions.

#### Scenario: Placeholder text is czagent-branded
- **WHEN** the prompt is empty on the home screen
- **THEN** placeholder text references czagent or ClickZetta Lakehouse capabilities

### Requirement: Home tips SHALL show ClickZetta-relevant content
The tips content strings SHALL reference ClickZetta Lakehouse workflows.

#### Scenario: Tips reference Lakehouse workflows
- **WHEN** tips are displayed on the home screen
- **THEN** tip content references ClickZetta-relevant tasks

### Requirement: Home footer SHALL display czagent version
The version string in the home footer SHALL use czagent branding. Directory and MCP status display SHALL remain unchanged.

#### Scenario: Footer shows czagent version
- **WHEN** the home footer renders
- **THEN** the version area shows "czagent" branding, not "opencode"
