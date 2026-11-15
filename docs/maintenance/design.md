# Design rationale

Two roles share existing intake, task state, receipts, and project memory. The Worker handles events and delegates long implementation; the Curator reads what happened once a day and curates shared memory with wide latitude over what to keep and how to organise it. Review and necessary contract updates accompany each task.

- [Building effective agents](https://www.anthropic.com/research/building-effective-agents): prefer simple, composable workflows. The service adds a small durable scheduler, not a second task engine.
- [Long-running agent harnesses](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents): preserve verifiable progress, isolated worktrees, exact-SHA review, and handoff.
- [Context engineering](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents): use short indexes, original notes on demand, durable evidence, and fresh contexts. Correct both conclusions and their entrypoints.
- [Building always-on agents](https://claude.com/resources/articles/building-always-on-agents): durable inbox, timers, memory, permissions and outbox surround short model runs. Existing intake/tasks/memory/outbox remain authoritative; SQLite owns only wakeups, timers, runs and health. Source scans run independently from the model. Failure recovery reconciles external effects before replay.
- [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode): each round uses `codex exec --json` with a private final-response file. Exit zero alone does not prove a completed turn.
- [Ralph](https://ghuntley.com/ralph/): improve from observed failures; do not impose its single-task execution pattern.
- [Scaling agents](https://cursor.com/blog/scaling-agents): separate coordination, implementation, and review without adding permanent roles.

Measure better decisions through offline cases and real usage, not note count or shorter prose. Distinguish reviewed memory from active memory. Do not send Feishu test messages; event-to-reply acceptance requires natural traffic and actual receipts.
