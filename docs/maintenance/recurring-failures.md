# Recurring failures

Keep lessons that change future handling: symptoms, evidence, known cause, recovery and preventive checks. Keep full investigations private; mark unknown causes explicitly.

<a id="有-loop-不等于有事件监听"></a>

## A loop does not prove a listener exists

Monitor access or local `ready` does not prove connectivity. Check the actual consumer, upstream `connected`, task ID and expiry. Stop the old task, verify consumer exit, then replace it and backfill gaps. Report unverified real-message delivery honestly; do not send Feishu test messages.

See [monitoring](workflow.md#wakeups-and-monitoring). Keep connection, stop and renewal evidence in private `control/feishu-monitor.json`.

<a id="根消息和-pr-head-未变化不代表没有新反馈"></a>

## Unchanged roots or PR heads can still have new feedback

Old-thread replies, ordinary PR comments and inline reviews update independently. Scan all sources, save each disposition before ack, and link stable sources to existing tasks. Do not advance past failed pagination.

See [intake](workflow.md#intake-and-delivery), [collector](../../scripts/maintenance/intake.ts) and [regressions](../../packages/cz-cli/test/maintenance-intake.test.ts).

<a id="独立审查沿用实施者的假设"></a>

## Review inherits implementation assumptions

Green tests can miss the original failure when acceptance assumes a deployment endpoint or tests only immediate auth success. Review the original request/latest decisions and independently verify coverage before checking the diff and results. “No new regression” does not prove the issue fixed. Unresolved original scenarios block approval; retain evidence for any genuine product-scope change.

See [independent review](workflow.md#task-lifecycle) and [authentication checks](understanding.md#private-deployment-authentication). Keep investigations/private discussions with task evidence; revise this entry for new conditions instead of duplicating daily summaries.

<a id="审查报告未读就合并"></a>

## Merging before the review report is read

Trigger: a reviewer delegate has finished, CI is green, and the merge guard accepts the task record.

On 2026-11-11 the Worker merged PRs 162–165 within minutes of their reviewer notifications arriving, before reading the reports, and saved records saying "APPROVE" ahead of the reports. It recurred in the records for PRs 167, 186 and 187. All reports later proved APPROVE, so nothing bad shipped, but `merge` checks only the task record (`status`, `phase`, `reviewedSha` equal to the head), not that a report was read. Main `cz-test` went red right after (PR 163's stall test), which is when the gap surfaced.

Next time: open the report, check its verdict, reviewed head and conditions, then save `reviewedSha`, then preview and merge. Wait for pending CI in the background instead of repeating the merge preview. Evidence: PRs [162](https://github.com/clickzetta/cz-cli/pull/162)–[165](https://github.com/clickzetta/cz-cli/pull/165); the session transcripts are private. Retire this entry if the merge tool starts checking the report itself.

<a id="github-https-间歇失败"></a>

## GitHub HTTPS fails intermittently on the maintenance host

Trigger: `sync`, `git fetch` or `git push` reports an empty reply or a port-443 timeout.

On 2026-11-10 and 2026-11-11 this happened in several Worker and Curator rounds: sync failed five times on 11-11 and implementer pushes needed up to eight attempts. The cause is unknown and lies outside the repository; the evidence is private (session transcripts). Retry a few times with growing pauses. Confirm a push landed with `git ls-remote origin BRANCH` before declaring it unpushed or pushing again, and never force. Do not pipe `sync` into `head` or similar before reading its exit status, because the pipe reports the last command's status. If sync still fails, follow the role prompt: report it and end the round. Remove this entry once a week passes without the failure.
