# Shared memory

Select a relevant note, then read its original evidence and verify current facts. Search by topic or symptom if needed; do not load the whole archive. Indexes navigate, not restate conclusions.

| Task                                                                           | Entry                                                                                            |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Installation, authentication, or misunderstood product behavior                | [Misunderstandings](../understanding.md)                                                         |
| Unresolved product, design, or authorization decisions                         | [Decisions](../decisions.md), private `control/daily-decisions.md`, then latest original replies |
| Repeated intake, monitoring, handoff, merge, network, or verification failures | [Recurring failures](../recurring-failures.md)                                                   |
| A known mistake in cz-cli or the ClickZetta SDK                                | [cli pitfalls](../../cli/pitfalls.md)                                                            |
| A known mistake in upstream opencode, injection, plugins, or re-baselining     | [opencode pitfalls](../../opencode/pitfalls.md)                                                  |
| A known mistake in tests, CI, pushing, or releases                             | [engineering pitfalls](../../engineering/pitfalls.md)                                            |

Run `bun scripts/maintenance.ts memory pending` when taking a task. Inspect relevant candidate files and evidence; candidates are not established rules. Verify contradictions before reusing a note.

Follow the [memory protocol](../memory-workflow.md). Claims, permissions, reviewed SHAs, CI, sends, and releases remain governed by live records and receipts. Keep private sources in runtime. Split growing topics only when useful, updating all affected links; keep common paths short.
