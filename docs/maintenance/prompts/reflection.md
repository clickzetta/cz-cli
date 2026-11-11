# Reflection

Follow [AGENTS](../../../AGENTS.md), the [workflow](../workflow.md), and the [memory protocol](../memory-workflow.md). Run every twelve hours.

1. Run `bun scripts/maintenance.ts sync` first; on failure, report it and stop. Read `memory pending` and changes since the last successful coverage point: tasks, commits, feedback, decisions, and verification. Start with the last day on first run. Preserve unread gaps; never advance a cursor past failed reads.
2. Keep only evidenced misunderstandings, unresolved human decisions, and recurring failures. Read their [original notes](../memory/INDEX.md). Memory cannot grant permission or replace live task and delivery state.
3. When evidence or a due topic warrants work, delegate to a fresh-context curator with original sources, scope, and current notes. Record its exclusive worktree and owner; do not duplicate a running curator. Rotate through old topics weekly.
4. Verify, merge, correct, and retire notes while preserving conditions, exceptions, provenance, and replacement links. Update affected indexes together. Do not turn historical state or temporary pauses into permanent rules.
5. Check human answers before updating private `control/daily-decisions.md`. Let Feedback ask in the original discussion. Route verifiable faults into existing tasks; create no parallel implementation queue or unsolicited report.
6. Work in an exclusive worktree from updated `origin/main`. Get an independent review of evidence and diff; run affected offline cases when conclusions, indexes, or read paths change. Fix failures without weakening criteria.
7. Open a docs-only PR and merge it with `gh pr merge --admin --squash`, then run `sync`. Resolve integrated events with the merged main commit; resolve verified duplicates or no-change events with evidence. Unresolved work stays pending.

If nothing warrants change, save coverage and stop. Do not publish releases, change code, expose private sources, or invent documentation work.
