# Maintenance

An external service runs bounded Codex Worker and Curator sessions. Durable intake, timers and task state survive a model process or host restart. The repository does not pin a model; choose it in private runtime configuration. Use [project docs](../INDEX.md) and shared notes on demand instead of client-private auto-memory.

- [Worker](prompts/worker.md): GitHub and Feishu intake, execution, and delivery. It delegates with the [implementer](prompts/delegate-implement.md) and [reviewer](prompts/delegate-review.md) briefs.
- [Curator](prompts/curator.md): daily curation of shared memory from what actually happened, plus a review of the day's merged code that files GitHub issues.
- [Codex service](codex.md): deployment, durable scheduling, failure reconciliation and acceptance.
- [Workflow](workflow.md): ownership, verification, guards, recovery, and handoff.
- [Memory index](memory/INDEX.md) and [protocol](memory-workflow.md): read, record, curate, validate, merge.
- [Offline cases](memory-cases.md): behavior checks with separate scoring.
- [Rationale](design.md), [misunderstandings](understanding.md), [decisions](decisions.md), [recurring failures](recurring-failures.md).

<a id="启用门槛"></a>

## Control checkout

The control checkout is a clean clone on `main` and is never edited in place. Every role runs `bun scripts/maintenance.ts sync ROLE` at each wake, which fast-forwards it to `origin/main` and returns `changedRules`: `AGENTS.md` and every changed file under `docs/`, including domain pitfalls and indexes, that changed since that role last confirmed a read. Roles share the checkout, so each keeps its own cursor in runtime `control/rules-seen-ROLE`, and the cursor moves only when the role confirms the read with `rules-read ROLE SHA`: a round that dies after syncing is told again. A running session rereads those files before acting; merged rules take effect only once they are reread, so step 1 of each role prompt asks for it explicitly. Start all coordinators and delegates there and run its maintenance tools. Pass task source worktrees explicitly; product fixes start from updated `origin/main`.

To move a deployment off the old pinned `native.policySha`, stop both roles at a safe boundary, then in the control checkout run `git switch main && git merge --ff-only origin/main`, remove `native.policySha` from `config.json`, run `sync`, and restart.

Keep credentials in private settings. Verify existing credentials, source scope, authorization, model connectivity, and a bounded first task; request missing inputs only. From the control root:

```sh
bun scripts/maintenance.ts init
bun scripts/maintenance.ts status
```

Reconcile existing tasks, pending sources, owners, and receipts. Removing old user worktrees requires item-specific approval and does not block startup.

<a id="飞书事件前提"></a>

## Feishu prerequisites

The Bot must belong to the target group, with `im:message.group_msg`, long-connection delivery, and a published `im.message.receive_v1` subscription. User read access or `send_as_bot` alone is insufficient. Check the installed CLI's `event schema im.message.receive_v1` and `event consume --help`; version 1.0.58 also checked `im:message.p2p_msg:readonly`. The current [Codex service](codex.md) polls history and does not require a long connection. For any future live listener, verify the actual consumer and upstream connection in addition to these prerequisites; polling success is not listener acceptance.

<a id="两个会话"></a>

## Start or recover

Follow [the Codex deployment procedure](codex.md). Stop the legacy Claude sessions, Cron jobs, Monitor tasks and their consumers before enabling the service. Preserve their handoff, transcripts, claims, worktrees, intake and receipts. The Codex service takes over the same runtime; starting a new empty runtime would lose deduplication and delivery history.

## Acceptance

Verify one supervised service, one active provider round at most, both intake sources and the durable daily Curator/five-minute Worker timers. Verify stop, restart, crash reconciliation and real model authentication. An idle Worker tick consumes no model tokens. An intake scan is scheduled every minute, independently of a busy or paused model; this is polling, not proof of a live Feishu long connection or a response-time guarantee.

Verify natural Issue/PR and Feishu input, source-to-task links, dispositions and receipts. Test replay/deduplication locally. **Never send Feishu test or diagnostic messages.** Natural-event-to-reply acceptance stays open until observed. CI and independent review remain required; releases remain nightly-only.
