# Design rationale

Two native roles share existing intake, task state, receipts, and project memory. Feedback handles events and delegates long implementation; Reflection curates evidence every twelve hours. Review and necessary contract updates accompany each task.

- [Building effective agents](https://www.anthropic.com/research/building-effective-agents): prefer simple, composable workflows; add no scheduler framework.
- [Long-running agent harnesses](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents): preserve verifiable progress, isolated worktrees, exact-SHA review, and handoff.
- [Context engineering](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents): use short indexes, original notes on demand, durable evidence, and fresh contexts. Correct both conclusions and their entrypoints.
- [Native scheduling](https://code.claude.com/docs/en/scheduled-tasks): verify actual jobs, expiry, and Monitor connections; a running process does not prove recovery.
- [Ralph](https://ghuntley.com/ralph/): improve from observed failures; do not impose its single-task execution pattern.
- [Scaling agents](https://cursor.com/blog/scaling-agents): separate coordination, implementation, and review without adding permanent roles.

Measure better decisions through offline cases and real usage, not note count or shorter prose. Distinguish reviewed memory from active memory. Do not send Feishu test messages; event-to-reply acceptance requires natural traffic and actual receipts.
