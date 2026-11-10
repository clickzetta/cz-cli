# Maintenance

Two Claude Code sessions use native `/loop` and `Monitor`. Default model: `claude-sonnet-5-5`. Disable client-private auto-memory only for these sessions; use [project docs](../INDEX.md) and shared notes on demand.

- [Feedback](prompts/feedback.md): GitHub and Feishu intake, execution, and delivery.
- [Reflection](prompts/reflection.md): twelve-hour evidence curation.
- [Workflow](workflow.md): ownership, verification, guards, recovery, and handoff.
- [Memory index](memory/INDEX.md) and [protocol](memory-workflow.md): read, record, curate, validate, activate.
- [Offline cases](memory-cases.md): behavior checks with separate scoring.
- [Rationale](design.md), [misunderstandings](understanding.md), [decisions](decisions.md), [recurring failures](recurring-failures.md).

<a id="启用门槛"></a>

## Control checkout

Use a committed, clean checkout with absolute `config.json.native.maintenanceRoot` and matching `native.policySha`. Start all coordinators and delegates there; read its rules and run its maintenance tools. Pass task source worktrees explicitly. Policy and source SHAs are separate; keep each stage's policy fixed. Product fixes start from updated `origin/main`, never from stale rules in their source worktree. A local control rollout need not first merge into main.

Keep credentials in private settings. Verify existing credentials, source scope, authorization, model connectivity, and a bounded first task; request missing inputs only. From the control root:

```sh
bun scripts/maintenance.ts init
bun scripts/maintenance.ts status
```

Reconcile existing tasks, pending sources, owners, and receipts. Removing old user worktrees requires item-specific approval and does not block activation.

<a id="飞书事件前提"></a>

## Feishu prerequisites

The Bot must belong to the target group, with `im:message.group_msg`, long-connection delivery, and a published `im.message.receive_v1` subscription. User read access or `send_as_bot` alone is insufficient. Check the installed CLI's `event schema im.message.receive_v1` and `event consume --help`; version 1.0.58 also checked `im:message.p2p_msg:readonly`. Follow the [listener workflow](workflow.md#wakeups-and-monitoring), verify the actual consumer and upstream connection, and fix missing prerequisites rather than declaring acceptance complete.

<a id="两个会话"></a>

## Start or recover

Create each role only once. Recover existing session IDs; use CronList to deduplicate instead of repeating `/loop`. When retiring old channel roles, hand off tasks, claims, workers, and receipts at a safe boundary, then remove their jobs and stop them. Keep one listener owner.

The existing maintenance authorization allows bypassPermissions. Use private settings that disable auto-memory without changing connection credentials:

```sh
CZ_MAINTENANCE_RUNTIME="$(git rev-parse --path-format=absolute --git-common-dir)/cz-maintenance"
CZ_MAINTENANCE_SETTINGS="$CZ_MAINTENANCE_RUNTIME/native-claude-settings.json"
CZ_MAINTENANCE_WORKTREES="$(bun -e 'console.log((await Bun.file(Bun.argv[1]).json()).native.worktreeRoot)' "$CZ_MAINTENANCE_RUNTIME/config.json")"
```

First creation only:

```sh
claude --background --name cz-feedback --model claude-sonnet-5-5 \
  --permission-mode bypassPermissions --allowedTools 'Bash,Agent,Skill,CronCreate,CronList,CronDelete,ToolSearch,Monitor,TaskStop' \
  --add-dir "$CZ_MAINTENANCE_RUNTIME" --add-dir "$CZ_MAINTENANCE_WORKTREES" \
  --settings "$CZ_MAINTENANCE_SETTINGS" \
  '/loop 5m Read and follow docs/maintenance/prompts/feedback.md.'

claude --background --name cz-reflection --model claude-sonnet-5-5 \
  --permission-mode bypassPermissions --allowedTools 'Bash,Agent,Skill,CronCreate,CronList,CronDelete,ToolSearch' \
  --add-dir "$CZ_MAINTENANCE_RUNTIME" --add-dir "$CZ_MAINTENANCE_WORKTREES" \
  --settings "$CZ_MAINTENANCE_SETTINGS" \
  '/loop 12h Read and follow docs/maintenance/prompts/reflection.md.'
```

Distinct tasks may run concurrently in exclusive worktrees; never duplicate a task's implementer. Review separately. The coordinator remains responsive.

Inspect with `claude agents` or `claude logs ID`; stop with `claude stop ID`. Existing server wrappers use `maintenance attach feedback` or `reflection`. Recovery must verify actual Cron/Monitor state and expiry, not just a process. GitHub currently polls; it has no webhook integration.

<a id="验收与恢复"></a>

## Acceptance

Confirm one five-minute Feedback job, one twelve-hour Reflection job, and one listener, with no obsolete channel jobs or duplicate workers. Renew jobs before their reported expiry. Verify real Issue/PR updates, natural Feishu events, task links, dispositions, and receipts. Test replay/deduplication locally. **Never send Feishu test or diagnostic messages.** Report only observed connection, intake, and delivery evidence; natural-event-to-reply acceptance stays open until demonstrated. CI and independent review remain required; releases remain nightly-only.

See official [session settings](https://code.claude.com/docs/en/settings#change-a-setting-for-one-session) and [native scheduling](https://code.claude.com/docs/en/scheduled-tasks).
