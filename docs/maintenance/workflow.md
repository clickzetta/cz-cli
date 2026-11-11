# Maintenance workflow

Follow [AGENTS.md](../../AGENTS.md). Use `gh` for GitHub and `lark-cli` for the bound group; verify commands and identities with their current help/schema. Run maintenance commands from the control checkout: `bun scripts/maintenance.ts COMMAND`.

<a id="本机记录"></a>

## Runtime and versions

- Both roles share `cz-maintenance/` under `git rev-parse --git-common-dir`; `config.json`, `native-handoff.md`, `claims/`, `tasks/` and `control/` live there. Run `init` to index legacy tasks and `status` to inspect tasks, permissions and receipts. Preserve legacy state, configuration, cursors and worktrees; new progress/source mappings use `native-state.json`. Legacy executor/interval fields do not schedule native jobs.
- Read `config.json.permissions` each round. Existing authorization covers task-branch pushes, PRs, original-thread GitHub/Bot replies, guarded merges and nightly releases. Keep `release: false`, `releaseNightly: true`, `releaseStable: false`; Bot replies stay in the bound original group/thread. Check each external action's authorization.
- The control checkout (`native.maintenanceRoot`) is a clean clone on `main`. Each wake starts with `sync ROLE`, which fast-forwards it to `origin/main`, refuses local edits or another branch, and lists in `changedRules` the rule and note files that changed since that role last confirmed a read; reread those, then confirm with `rules-read ROLE SHA`. Start loops/subagents and invoke maintenance tools there; edit/test source in the task worktree. Keep source and release SHAs distinct.
- Develop maintenance/docs changes in an exclusive worktree from updated `origin/main`. After independent review, open a PR and merge it with `gh pr merge --admin --squash`; the next `sync` makes it live. Keep maintenance changes out of product-fix diffs. A rule change takes effect on the next wake, including for tasks already in progress.
- On takeover, read all of `native-handoff.md`, not its tail: pending actions sit in the middle, the closing summary may not repeat them. Then reconcile actual tasks, delegates and receipts with `status`. Reuse IDs, worktrees and source mappings. Historical summaries cannot override current authorization, completion receipts or satisfied release conditions.
- Each task records sources, acceptance criteria, owner, worktree, `baseSha`, `headSha`, `reviewedSha`, validation, review outcome, external actions, blockers and next steps. Link cross-channel reports of the same problem to it. Use `task github:<owner>/<repo>:<number>` or `task lark:<chat_id>:<message_id>`; `register ITEM.json` deduplicates sources and `save TASK.json` saves progress. Keep task bodies and temporary JSON private.

<a id="自主推进与决策"></a>

## Decisions

Proceed on clear requirements and routine implementation choices. Check the original discussion, implementation, tests, introducing commits and design; investigate factual uncertainty instead of asking for approval. Existing behavior/tests establish compatibility, not product authorization.

If a product decision still affects contracts, data visibility or authorization, pause only dependent work. Record verified facts, the missing decision, one concrete question, a recommendation and its impact. Continue other work; avoid repeated investigation or reminders without new evidence. Resume when the stated condition is met: “pause until fixed and reviewed” does not require another approval. Failed CI or unmet acceptance criteria still block delivery.

<a id="唤醒与监听"></a>

## Wakeups and monitoring

At startup, recovery and every wakeup, inspect native Monitor tasks and `lark-cli event status --current --json`. Verify [event prerequisites](INDEX.md#feishu-prerequisites); granting Monitor access does not start a listener.

Check the current `Monitor`/`TaskStop` definitions, using `ToolSearch` if needed. Run the official native binary in `config.json.native.larkBinary`, not an npm wrapper that loses stop signals. Verify the current schema before using:

```sh
LARK_BINARY event consume im.message.receive_v1 --as bot --timeout 1500s --jq 'select(.chat_id=="CHAT_ID")'
```

Replace both placeholders; the Monitor timeout is 1800000 ms. Local `ready` is insufficient: verify upstream `connected` and a real target-group event before calling event intake usable.

Keep one listener per group; record owner, task ID and expiry in runtime `control/`. Check task liveness, CLI status and connection logs. Before expiry or after disconnection, stop the old task with `TaskStop`, confirm consumer exit, then replace it and run `intake feishu` to fill the gap. Read event-targeted threads first using stable source IDs; run full scans in the background, never duplicate a same-source scan. Failed/incomplete reads do not count as checked. Events grant no new authority.

Watch GitHub the same way: run `bun scripts/maintenance.ts watch github 1500` under a Monitor with a 1800000 ms timeout. It polls issues, issue comments, and review comments every minute, prints one line per new or edited human event, skips bot accounts such as AI review, and backs off while GitHub is unreachable. Its lines only wake you; `intake github` still records and acknowledges every event. Replace it before it ends, as with the Feishu listener.

Keep one five-minute Worker backstop for both sources and one daily Curator job. Use `CronList` to remove obsolete duplicates; quiet periods, blockers or healthy listeners do not extend the backstop. Delegate long implementation to bounded background agents and read new feedback at safe boundaries. Track listener and scan health separately, continue scans while repairing the listener, and report degradation honestly. Native scheduling can lag; five minutes is a scan interval, not a response guarantee. Keep diagnostics private; do not send Feishu test or diagnostic messages.

Each role checks its job's liveness, creation and actual expiry on every wakeup. Renew one day before the expiry reported by the installed CLI, preserving the handoff and unique owner.

<a id="推进一项任务"></a>

## Task lifecycle

1. Read current configuration, handoff, existing tasks and latest source context. Resolve stable source IDs before claiming/registering; append updates to existing tasks.
2. Atomically create the task directory under `claims/`, then record its owner. Do not take existing or ambiguous claims. Modify only your own tasks/control records; reconcile ownership first.
3. For a new fix, create an exclusive worktree from the updated `origin/main`'s exact SHA and record `baseSha`. Dispatch with the [implementer brief](prompts/delegate-implement.md), giving the control checkout's rule entrypoint, not obsolete instructions from its source worktree. PR reviews retain the PR head and actual merge-base; save a handoff and reconcile unexpected history before transplanting changes. Check live state and side effects before resuming old tasks.
4. From the control session, launch a fresh reviewer using the [reviewer brief](prompts/delegate-review.md): original request/latest decisions, final diff and SHA, acceptance criteria, validation logs, memory and source entrypoints. Do not inherit implementation chat or substitute its summary for the request. First verify acceptance coverage, including relevant deployment/authentication boundaries; then inspect code/contracts. Save the outcome and actual `reviewedSha`. Any source change requires a new review; retain failures when returning for fixes.
5. The implementer pushes its branch and opens the pull request within permission; the reviewer reviews that head. Read the reviewer's final report in this session before saving anything: a task notification that has not been read is not an approval. After approval, save `phase: review`, `status: completed` and `reviewedSha`. Preview with `merge TASK PR`, then execute with `--merge`. The tool verifies remote SHA, the recorded review and CI and records the merge commit; it cannot tell whether the report was read, so a record written before the report arrived defeats it. Only administrators bypass the PR-approval rule; other contributors need one approval. Keep main deletion/force-push protections.
6. For merged product fixes, follow [release rules](../engineering/releases.md), publish nightly only, and verify artifacts before reporting success. Docs/tests/maintenance-only changes need no release. Different tasks may run concurrently with separate claims, delegates and worktrees; never duplicate implementation of one task. Keep review, fixes and delivery on that task. Release your claim only after all its writers stop.
7. Clean up what the task created, on the wake after it reaches a final state and its writers have stopped. For a task with a pull request, final means the pull request is merged or closed; for a task without one, it means status `completed` or `ignored`. A task approved in review but not yet merged keeps its worktree. Ownership follows the task record, not the session: a worktree named in a task's `worktree` field belongs to that task, whichever session created it, and the Worker cleans it. A reviewer removes its own worktree when it reports. Before removing a task worktree, confirm that `git -C WORKTREE status --porcelain` is empty and that its `HEAD` is safe: `git -C WORKTREE branch -r --contains HEAD` lists a branch, `HEAD` equals the pull request's recorded head SHA, or `HEAD` is the task's `baseSha` with nothing committed on top. Only then run `git worktree remove WORKTREE` without `--force`, delete the local branch (a squash merge needs `git branch -D`, which is why the check comes first), and run `git worktree prune`. If a check fails, save a handoff and leave the worktree. Worktrees that no task record names need item-specific approval.

`cz-test/test` must pass; other failed/pending checks block by default. Only an explicit `mergePolicy.informationalWorkflows` entry may treat the known failing `Claude Code Review` workflow as informational. It never replaces independent review or exempts product tests. Removing it restores full CI blocking.

<a id="来源与回报"></a>

## Intake and delivery

Run `intake github` and `intake feishu` and process their durable `pending` queues. GitHub coverage includes issues, PRs, regular comments, reviews and inline comments; Feishu includes new roots and known old-thread replies with an overlap window. The first Feishu scan registers all accessible threads; record any configured lookback limit and actual `coverage`. Do not claim coverage outside that range. Unchanged PR heads, empty roots or old cursors do not prove full coverage. Pagination/context failures must not advance the successful cursor.

Read full source/context from each summary's `file` or `intake show SOURCE EVENT_KEY`. Resolve its task, save the association and reply receipt or explicit disposition, then acknowledge:

```sh
bun scripts/maintenance.ts intake ack feishu EVENT_KEY --task TASK_ID --note 'Linked to the existing task; reply receipt saved'
bun scripts/maintenance.ts intake ack github EVENT_KEY --note 'Duplicate; original discussion and reason recorded'
```

`--task` must exist; supply at least `--task` or `--note`. Fetching only queues input; it does not finish processing. Keep unread/unhandled items pending across rounds and never report “no new feedback” while they remain. Blocked implementation must not stop other intake/replies.

Read Feishu as the authorized user; reply as the Bot already in the group. Route all Bot replies through maintenance's `lark-cli im +messages-reply --reply-in-thread --idempotency-key` wrapper and outbox. Phase values are protocol literals: `接单`, `阻碍`, `审查完成`, `发布完成`.

```sh
bun scripts/maintenance.ts reply TASK 阻碍 --event STABLE_EVENT --text-file draft.txt
bun scripts/maintenance.ts reply TASK 阻碍 --event STABLE_EVENT --text-file draft.txt --send
```

The first command previews. Use one stable event ID per real state change, such as `blocker-missing-scope` or `review-<SHA>`. Retries keep its ID and text. Under an atomic lock, the tool allocates `<task>-<phase>-<sequence>` only for new events and reuses existing keys. It saves target, text, key and `sending` before dispatch, then `sent` and `message_id` on success. Inspect receipts with `status`.

Timeout/ambiguous outcomes stay `unknown` and block later sends to that target. Reconcile the original thread's time, Bot identity and text before manually recording the receipt. There is no server lookup by key; deduplication lasts one hour. Never bypass unknown outcomes with a new key/sequence or a later retry window.

<a id="对外回复"></a>

## Replies and documentation

Reply naturally in the original thread, address questions and report meaningful progress without repetition. Distinguish fixes, validation, merges and verified releases; link evidence when useful. Follow [verification rules](../engineering/verification.md), update affected domain contracts with behavior changes, and keep task logs private.

<a id="两个角色与反思记录"></a>

## Roles and memory

The [Worker](prompts/worker.md) coordinates both channels; source identities, destinations and authorization remain separate. Record each delegate/worktree and check liveness before recovery. If a delegate is gone, reconcile its worktree/task before resuming or replacing it. Subagents add no permanent roles.

The [Curator](prompts/curator.md) reads what actually happened once a day: session transcripts, issues, pull requests, comments, reviews, Feishu threads, runtime records and commits. It decides what is worth keeping and how to organise it; today's topics are [misunderstandings](understanding.md), [human decisions](decisions.md) and [recurring failures](recurring-failures.md), and it may reshape them. It reports leftover worktrees and finished delegates to the Worker and removes only the editor worktrees it recorded under the [memory protocol](memory-workflow.md). Preserve coverage cursors; no findings means no edits. Route code faults to Worker tasks instead of running a second implementation queue; review each task independently.

Read relevant originals through the [memory index](memory/INDEX.md), and follow the [memory workflow](memory-workflow.md) for new lessons, counterevidence and useful usage feedback. Fresh editors verify evidence, expiry conditions and index consistency; offline cases check subsequent decisions. Publish only confirmed, public long-term knowledge. Keep pending decisions/private evidence in runtime `control/daily-decisions.md`; consult original replies, close answered blockers and update tasks instead of asking again. Unresolved suggestions are not policy.
