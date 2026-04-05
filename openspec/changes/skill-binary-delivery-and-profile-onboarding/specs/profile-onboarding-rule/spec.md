## ADDED Requirements

### Requirement: Rule 0 — Profile onboarding via interactive clarification
The SKILL SHALL instruct AI Agents to detect the absence of a configured profile and guide users through profile initialization using the AskUserQuestion tool before attempting any data-plane command.

#### Scenario: Agent detects no profile configured
- **WHEN** user makes a request that requires a Lakehouse connection
- **AND** Agent runs `cz-cli profile list` and receives an empty data array or a no-profiles error
- **THEN** Agent MUST NOT attempt to execute the original command
- **AND** Agent MUST enter the profile onboarding flow using AskUserQuestion tool (not plain text)

#### Scenario: Agent collects auth method first
- **WHEN** Agent enters profile onboarding flow
- **THEN** Agent MUST ask the user to choose authentication method: PAT (Personal Access Token) or username/password
- **AND** Agent MUST use AskUserQuestion tool with options, not a freeform text prompt
- **AND** PAT is presented as the recommended option

#### Scenario: Agent collects connection details step by step
- **WHEN** user selects authentication method
- **THEN** Agent collects remaining required fields via AskUserQuestion: instance ID, workspace name
- **AND** Agent MAY collect optional fields (schema, vcluster) in a follow-up question
- **AND** Agent MUST NOT ask for all fields in a single overwhelming message

#### Scenario: Agent creates profile from collected info
- **WHEN** all required connection details are collected
- **THEN** Agent calls `cz-cli profile create <name> [--pat VALUE | --username VALUE --password VALUE] --instance VALUE --workspace VALUE`
- **AND** Agent verifies the profile was created successfully (exit_code=0, ok=true)
- **AND** Agent then proceeds to execute the original user request using the new profile

#### Scenario: Onboarding not triggered when profile exists
- **WHEN** `cz-cli profile list` returns one or more profile entries
- **THEN** Agent proceeds normally without entering onboarding flow
- **AND** Agent uses the default profile or the profile specified by the user

#### Scenario: Network error distinguished from missing profile
- **WHEN** `cz-cli profile list` fails with a connection or network error (not an empty list)
- **THEN** Agent MUST NOT enter profile onboarding flow
- **AND** Agent reports the error to the user and asks them to check connectivity or credentials

### Requirement: Rule 0 placed before all other behavior rules
Rule 0 SHALL appear as the first rule in the AI Agent Behavior Rules section of SKILL.md, preceding Rule 1 (state-changing operations).

#### Scenario: Rule 0 is the first rule in SKILL.md
- **WHEN** an AI agent reads the SKILL.md behavior rules section
- **THEN** Rule 0 (profile onboarding) appears before Rule 1 (clarify intent)
- **AND** its heading is `### Rule 0 — Initialize connection profile before first use`
