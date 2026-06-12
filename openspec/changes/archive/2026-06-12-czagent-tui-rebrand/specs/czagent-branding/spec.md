## ADDED Requirements

### Requirement: User-facing TUI text SHALL use czagent branding
The TUI SHALL display "czagent" or "CZAgent" wherever "opencode" or "OpenCode" previously appeared in user-visible text within the TUI layer. A centralized `brand.ts` module SHALL export brand constants. Internal identifiers, import paths, package names, config file paths, and environment variables SHALL NOT be changed.

#### Scenario: TUI displays czagent branding
- **WHEN** the user interacts with the TUI (home screen, session, dialogs)
- **THEN** all user-visible text references the product as "czagent" or "CZAgent"

#### Scenario: Internal paths are unchanged
- **WHEN** the system resolves config paths, env vars, or package imports
- **THEN** they continue to use "opencode" naming (e.g., `~/.opencode/`, `OPENCODE_*`, `@opencode-ai/*`)

### Requirement: CLI wordmark SHALL display czagent identity
The non-TUI CLI output (used when stdout is not a TTY) SHALL render a "czagent" wordmark instead of the OpenCode wordmark in `cli/ui.ts`.

#### Scenario: Piped output shows czagent wordmark
- **WHEN** the CLI output is piped (not a TTY)
- **THEN** the wordmark text reads "czagent" instead of "opencode"

### Requirement: OpenCode commercial features SHALL be deleted with TODO stubs
The `dialog-go-upsell.tsx` and `dialog-console-org.tsx` components SHALL be deleted. Where they were imported/registered, TODO comments SHALL be left indicating future ClickZetta equivalents. No replacement features SHALL be built.

#### Scenario: Commercial dialogs are removed
- **WHEN** the user interacts with the TUI in any workflow
- **THEN** no OpenCode Go/Zen upsell or console org picker dialogs appear

#### Scenario: TODO stubs exist for future replacement
- **WHEN** a developer reads `app.tsx` where commercial dialogs were registered
- **THEN** TODO comments indicate where to add ClickZetta account/subscription features
