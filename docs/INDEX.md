# Project docs

Pick the entry for your task, then read only the topics it points to. Indexes navigate; each fact lives in one topic. Update the affected topic with the change it describes.

| Task | Start at |
| --- | --- |
| Change a cz-cli command, its output, or the ClickZetta SDK | [cli](cli/INDEX.md) |
| Change how cz-cli runs on upstream opencode: agent runtime, plugins, sessions, upstream patches | [opencode](opencode/INDEX.md) |
| Test, verify, push, or release | [engineering](engineering/INDEX.md) |
| Product direction and scope | [project](project/INDEX.md) |
| The Worker and Curator loops, and shared memory | [maintenance](maintenance/INDEX.md) |

Code decides which topic owns a fact: `packages/cz-cli` and `packages/clickzetta-sdk` belong to **cli**; `packages/opencode`, `core`, `tui`, `schema`, and `plugin` belong to **opencode**. Where cz-cli reaches into upstream, the [extension points](opencode/extension-points.md) own the description and cli topics link to it.

Each of cli, opencode, and engineering keeps a `pitfalls.md`: mistakes that already happened and will happen again unless someone checks. Read it before changing that area. Process lessons about the loops themselves live in [shared memory](maintenance/memory/INDEX.md).

Follow [AGENTS](../AGENTS.md). Keep credentials, task state, cursors, and delivery receipts in private runtime records.
