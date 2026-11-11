# Maintenance

Two Claude Code sessions use native `/loop` and `Monitor`. The repository does not pin a model; choose it in local runtime configuration, including a stronger one for reviewers. Disable client-private auto-memory only for these sessions; use [project docs](../INDEX.md) and shared notes on demand.

- [Worker](prompts/worker.md): GitHub and Feishu intake, execution, and delivery. It delegates with the [implementer](prompts/delegate-implement.md) and [reviewer](prompts/delegate-review.md) briefs.
- [Curator](prompts/curator.md): twelve-hour curation of shared memory from what actually happened.
- [Workflow](workflow.md): ownership, verification, guards, recovery, and handoff.
- [Memory index](memory/INDEX.md) and [protocol](memory-workflow.md): read, record, curate, validate, merge.
- [Offline cases](memory-cases.md): behavior checks with separate scoring.
- [Rationale](design.md), [misunderstandings](understanding.md), [decisions](decisions.md), [recurring failures](recurring-failures.md).

<a id="启用门槛"></a>

## Control checkout

The control checkout is a clean clone on `main` and is never edited in place. Every role runs `bun scripts/maintenance.ts sync ROLE` at each wake, which fast-forwards it to `origin/main` and returns `changedRules`: `AGENTS.md` and the files under `docs/maintenance`, notes included, that changed since that role last synced. Roles share the checkout, so each keeps its own cursor in runtime `control/rules-seen-ROLE`, and the cursor moves only when the role confirms the read with `rules-read ROLE SHA`: a round that dies after syncing is told again. A running session rereads those files before acting; merged rules take effect only once they are reread, so the wake prompt asks for it explicitly. Start all coordinators and delegates there and run its maintenance tools. Pass task source worktrees explicitly; product fixes start from updated `origin/main`.

To move a deployment off the old pinned `native.policySha`, stop both roles at a safe boundary, then in the control checkout run `git switch main && git merge --ff-only origin/main`, remove `native.policySha` from `config.json`, run `sync`, and restart.

Keep credentials in private settings. Verify existing credentials, source scope, authorization, model connectivity, and a bounded first task; request missing inputs only. From the control root:

```sh
bun scripts/maintenance.ts init
bun scripts/maintenance.ts status
```

Reconcile existing tasks, pending sources, owners, and receipts. Removing old user worktrees requires item-specific approval and does not block startup.

<a id="飞书事件前提"></a>

## Feishu prerequisites

The Bot must belong to the target group, with `im:message.group_msg`, long-connection delivery, and a published `im.message.receive_v1` subscription. User read access or `send_as_bot` alone is insufficient. Check the installed CLI's `event schema im.message.receive_v1` and `event consume --help`; version 1.0.58 also checked `im:message.p2p_msg:readonly`. Follow the [listener workflow](workflow.md#wakeups-and-monitoring), verify the actual consumer and upstream connection, and fix missing prerequisites rather than declaring acceptance complete.

<a id="两个会话"></a>

## Start or recover

Create each role only once. Recover existing session IDs; use CronList to deduplicate instead of repeating `/loop`. When retiring old channel roles, hand off tasks, claims, delegates, and receipts at a safe boundary, then remove their jobs and stop them. Keep one listener owner.

The existing maintenance authorization allows bypassPermissions. Use private settings that disable auto-memory without changing connection credentials:

```sh
CZ_MAINTENANCE_RUNTIME="$(git rev-parse --path-format=absolute --git-common-dir)/cz-maintenance"
CZ_MAINTENANCE_SETTINGS="$CZ_MAINTENANCE_RUNTIME/native-claude-settings.json"
CZ_MAINTENANCE_WORKTREES="$(bun -e 'console.log((await Bun.file(Bun.argv[1]).json()).native.worktreeRoot)' "$CZ_MAINTENANCE_RUNTIME/config.json")"
# The Curator reads session transcripts here. Give maintenance its own CLAUDE_CONFIG_DIR so this holds no unrelated projects.
CZ_MAINTENANCE_TRANSCRIPTS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects"
```

First creation only:

```sh
claude --background --name cz-worker \
  --permission-mode bypassPermissions --allowedTools 'Bash,Agent,Skill,CronCreate,CronList,CronDelete,ToolSearch,Monitor,TaskStop' \
  --add-dir "$CZ_MAINTENANCE_RUNTIME" --add-dir "$CZ_MAINTENANCE_WORKTREES" \
  --settings "$CZ_MAINTENANCE_SETTINGS" \
  '/loop 5m Run bun scripts/maintenance.ts sync worker, then read docs/maintenance/prompts/worker.md and every file listed in changedRules, and follow them.'

claude --background --name cz-curator \
  --permission-mode bypassPermissions --allowedTools 'Bash,Agent,Skill,CronCreate,CronList,CronDelete,ToolSearch' \
  --add-dir "$CZ_MAINTENANCE_RUNTIME" --add-dir "$CZ_MAINTENANCE_WORKTREES" --add-dir "$CZ_MAINTENANCE_TRANSCRIPTS" \
  --settings "$CZ_MAINTENANCE_SETTINGS" \
  '/loop 12h Run bun scripts/maintenance.ts sync curator, then read docs/maintenance/prompts/curator.md and every file listed in changedRules, and follow them.'
```

Distinct tasks may run concurrently in exclusive worktrees; never duplicate a task's implementer. Review separately. The coordinator remains responsive.

The wake prompt above is the only one: scheduled jobs, wrappers, and recovery reuse it verbatim instead of restating rules. A long-lived session drifts from the files it read hours ago, so restart each role at a safe boundary at least daily and after a large rule change; the handoff and task state carry everything it needs.

Inspect with `claude agents` or `claude logs ID`; stop with `claude stop ID`. Existing server wrappers use `maintenance attach worker` or `curator`. Of the runtime files, only `control/reflection-runtime.json` is renamed, to `curator-runtime.json`; other records keep their historical names. Recovery must verify actual Cron/Monitor state and expiry, not just a process. GitHub currently polls; it has no webhook integration.

<a id="验收与恢复"></a>

## Acceptance

Confirm one five-minute Worker job, one twelve-hour Curator job, and one listener, with no obsolete channel jobs or duplicate delegates. Renew jobs before their reported expiry. Verify real Issue/PR updates, natural Feishu events, task links, dispositions, and receipts. Test replay/deduplication locally. **Never send Feishu test or diagnostic messages.** Report only observed connection, intake, and delivery evidence; natural-event-to-reply acceptance stays open until demonstrated. CI and independent review remain required; releases remain nightly-only.

See official [session settings](https://code.claude.com/docs/en/settings#change-a-setting-for-one-session) and [native scheduling](https://code.claude.com/docs/en/scheduled-tasks).
