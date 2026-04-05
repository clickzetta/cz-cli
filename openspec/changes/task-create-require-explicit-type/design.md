## Context

`cz-cli task create` currently allows omitting `--type` because the Click option has a default `SQL`. This behavior is risky in AI-agent workflows: when an agent forgets `--type`, the CLI still succeeds and creates the wrong task type. The mistake is often detected later during `task save` or execution.

The change is local to task-creation command parsing and does not require backend API or MCP schema changes.

## Goals / Non-Goals

**Goals:**
- Make task type explicit at creation time by requiring `--type`.
- Fail fast on missing `--type` before any downstream create API call.
- Preserve existing accepted type values and mapping behavior (`SQL/PYTHON/SHELL/SPARK/FLOW` or integer code).
- Keep folder resolution behavior unchanged (ID and name forms remain valid).

**Non-Goals:**
- No change to Studio backend task type enums or API contracts.
- No inference of task type from script content or filename.
- No change to non-create task commands.

## Decisions

### 1. Enforce required type at Click option layer
`task create --type` will be switched from defaulted option to `required=True`.

Rationale:
- Click provides a standard usage error path (`Missing option '--type'`) with no custom logic.
- Validation happens before command body execution, guaranteeing no accidental `create_task` call.
- The behavior is deterministic for both humans and AI agents.

Alternative considered:
- Keep optional `--type` and add runtime guard in command body.
  - Rejected because runtime checks still allow code paths to evolve incorrectly and are easier to bypass accidentally.

### 2. Keep parsing and enum mapping unchanged
`_parse_task_type` remains the single parser for symbolic names and integer codes.

Rationale:
- Limits change scope to input contract and reduces regression risk.
- Maintains backward compatibility for valid existing typed callers.

### 3. Add explicit task-type guidance in agent-facing docs
Skill/template guidance will include an explicit rule to always pass `--type` for task creation.

Rationale:
- Complements CLI hard validation by reducing first-attempt failures in agent orchestration.
- Keeps guidance aligned with actual command contract.

## Risks / Trade-offs

- [Compatibility break for implicit callers] Existing scripts that omitted `--type` will now fail.
  - Mitigation: clear usage error and documentation updates; fix is straightforward (`--type <TYPE>`).
- [Higher friction for ad-hoc manual usage] Users must always provide one extra argument.
  - Mitigation: explicitness is intentional and prevents expensive mis-creation.
- [Agent prompt drift] Some prompts or cached skill docs may still omit `--type`.
  - Mitigation: update skill template and generated skill artifacts in the same change.

## Migration Plan

1. Update `task create` option contract to require `--type`.
2. Update command/skill guidance text to state explicit type requirement.
3. Add regression tests for:
   - Missing `--type` returns usage error and does not invoke downstream create API.
   - Existing typed creation path remains successful.
4. Validate with targeted pytest and CLI help checks.

Rollback:
- Restore default `SQL` on `--type` and remove required constraint if unexpected compatibility impact appears.

## Open Questions

- Should we add a dedicated error hint suggesting `--type PYTHON` for Python-task intents, or keep default Click usage error only?
