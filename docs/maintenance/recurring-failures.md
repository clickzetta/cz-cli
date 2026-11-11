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
