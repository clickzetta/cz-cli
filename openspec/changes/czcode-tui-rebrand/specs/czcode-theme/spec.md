## ADDED Requirements

### Requirement: Default theme SHALL use ClickZetta brand colors
A new theme file `czcode.json` SHALL be created alongside existing themes with ClickZetta brand colors. The primary accent color SHALL be `#1677FF`. The dark mode background SHALL use a cool dark tone. The neutral scale SHALL use cool gray tones.

#### Scenario: Fresh install uses czcode theme
- **WHEN** a user launches czcode for the first time with no theme configuration
- **THEN** the TUI renders using the czcode theme with ClickZetta blue as the primary accent

#### Scenario: Theme file is valid
- **WHEN** the theme system loads `czcode.json`
- **THEN** all required theme properties are defined and resolve to valid colors

### Requirement: czcode theme SHALL be the default via one-line change
The theme resolution logic SHALL select `czcode` as the default theme when no user preference is set. This SHALL be a single string change in the theme resolution code.

#### Scenario: No theme configured
- **WHEN** the user has not set a theme in their TUI config
- **THEN** the theme system resolves to `czcode` as the active theme

#### Scenario: User can still select other themes
- **WHEN** the user sets a different theme in their TUI config
- **THEN** that theme is applied instead of czcode

### Requirement: Existing themes SHALL remain untouched
All existing bundled themes SHALL NOT be modified. The `opencode.json` theme file SHALL be retained as-is for upstream compatibility.

#### Scenario: opencode.json is unchanged
- **WHEN** comparing `opencode.json` with the upstream version
- **THEN** the files are identical
