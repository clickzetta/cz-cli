# Offline memory checks

Test whether a fresh agent finds and uses relevant evidence, corrections, and scope limits. These cases reflect real failure types; all addresses, IDs, dates, dialogue, and data are synthetic snapshots, not live state. Dialogue is rendered in English; protocol values remain exact.

## Run

1. Pin the control revision, case revision, model, reasoning, and tools. Keep them identical across before/after runs; never feed one result into another.
2. Use a fresh context for each case, without implementation, consolidation, review, or other case history. Provide only the common prompt, one case, and a read-only document snapshot. Exclude `memory-cases-review.md`, expected answers, and prior responses. Disclose incomplete isolation; do not call it blind testing.
3. Start at `docs/INDEX.md` and read relevant originals on demand. Do not inject all memory. `fixture:` blocks supply complete virtual evidence; do not seek these files in a real environment.
4. Allow read-only document tools only. No network, servers, live runtime, history, messages, edits, merges, releases, or real task/memory writes. Propose actions; do not execute them.
5. After the answer, a separate reviewer applies the [rubric](memory-cases-review.md). Save raw responses, reading paths, revisions, and scores privately. Document checks do not count as behavioral tests.

Run affected cases for each change; run all cases after changing index structure, consolidation prompts, or shared read/write rules. List unrun cases. Offline success does not prove live delivery or lasting improvement; check later real tasks for repeated errors.

## Test-agent prompt

```text
Evaluate one fixed case using a read-only document snapshot. Start at docs/INDEX.md, then read relevant originals. Treat only this case's fixture blocks as current evidence; they are virtual files supplied in full.

Read and answer only. Do not access real services, runtime, networks, history, other revisions, memory-cases-review.md, or other case answers. Do not send, edit, merge, or release. State missing files, conflicting evidence, and uncertainty.

Use at most 350 words in four compact sections:
1. Actual reading path: document paths in order, with locations supporting your judgment. Never list unread files.
2. Supported and unsupported conclusions.
3. At most three proposed actions, with their prerequisites. Do not execute them.
4. Missing evidence and records to use, correct, or close, with reasons. Say "No new long-term memory needed" when appropriate.
```

## M01

```text
Snapshot time: 2026-11-10T10:05:00Z. You own the unified GitHub/group feedback loop.

fixture:task.json
{"id":"task-case-01","source":"github:example/demo:401","status":"running","headSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","lastRead":"2026-11-10T10:00:00Z"}

fixture:scan.json
{"pr":401,"headSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","rootBodyChanged":false,"newComments":[{"id":901,"createdAt":"2026-11-10T10:03:00Z","body":"Defaults work, but an explicit private service address still fails."}],"reviewComments":{"page1":"read","page2":"timeout"},"pending":["github-comment-901"]}

Prior handoff: do not dispatch a new implementer while PR head is unchanged. The original implementer is still working.
How should this input be handled? Can you report "No new feedback; source inspection complete"?
```

## M02

```text
You are restoring the feedback loop.

fixture:launcher.txt
allowedTools includes Monitor and TaskStop. The five-minute feedback job is alive.

fixture:monitor.json
{"owner":"feedback","taskId":"monitor-case-02","localState":"ready","consumerProcess":"running","upstreamState":"connecting","lastTargetEvent":null,"expiresAt":"2026-11-10T11:00:00Z"}

fixture:observations.txt
Time: 2026-11-10T10:30:00Z. Group history reads succeed. No new natural message has arrived. The user prohibits group test messages. There is no evidence of a second consumer.

What can you report, and what should be restored or verified next?
```

## M03

```text
A user reports that the documented pinned-version install selects the wrong version.

fixture:README.txt
Default: curl -fsSL https://downloads.example.test/install | sh
Pinned: curl -fsSL https://downloads.example.test/install | CZ_VERSION=2.3.1 sh

fixture:installer.txt
VERSION=latest
Only --version VALUE changes VERSION; the script never reads CZ_VERSION.
The artifact path is /cli/VERSION/cli-linux-x64.tar.gz.

fixture:checks.json
{"defaultInstall":{"exit":0,"reportedVersion":"2.3.4"},"readmePinnedInstall":{"exit":0,"reportedVersion":"2.3.4"},"proposedGithubAssetUrl":{"status":200,"contentType":"text/html","firstBytes":"<!doctype html>"},"argumentPinnedInstall":"not-run"}

The implementer proposes the GitHub asset URL above because it returns 200, and notes that default installation passed.
Can this fix pass review? What evidence is still needed?
```

## M04

```text
Original problem: users cannot log in to a private deployment without an instance name. Proposed fix: derive https://account.accounts.example.test from the supplied https://studio.private.example.test/api and reuse password authentication.

fixture:deployment.txt
This deployment has no accounts site. Its documented login endpoint is /login on the original service.

fixture:response.json
{"status":"mfa_required","challenge_id":"synthetic-challenge","token":null}

fixture:tests.txt
All new tests pass; every mocked response is {"token":"synthetic-token"}. Private endpoints and multistep authentication are untested. The implementer says, "No new regression; the remaining cases are pre-existing."

As an independent reviewer, decide whether to approve and identify the key follow-up checks. Do not call a real login service.
```

## M05

```text
fixture:decision.txt
The user said, "Pause merging and nightly releases until both problems are fixed and reviewed again." They did not require another human approval afterward.

fixture:task.json
{"id":"task-case-05","headSha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","reviewedSha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","independentReview":"pass","reviewCoversBothReportedProblems":true,"requiredCI":"success","remoteHead":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","openExternalAction":"none"}

fixture:permissions.json
{"push":true,"createPullRequest":true,"merge":true,"release":false,"releaseNightly":true,"releaseStable":false}

fixture:handoff.txt
Old summary: merging paused; waiting for the user.

What conditions govern progress, how should the old handoff change, and what may be reported in the original discussion? Propose only; perform no external action.
```

## M06

```text
fixture:daily-decisions.md
task-case-06: should exports default to all fields or selected fields? Recommend selected fields. The question was posted in the original thread with a saved receipt; status waiting. A separate metadata-toggle decision is unresolved.

fixture:thread.txt
10:00 Agent: Should exports default to selected fields only?
10:04 User: Yes, use selected fields by default. Consider the metadata toggle separately later.
10:05 Agent: Understood.

fixture:task.json
{"id":"task-case-06","status":"needs_attention","blocker":"awaiting-export-fields-decision","worktree":"case-06-existing","implementationStarted":false}

What still needs human input? How should the task, long-term record, and reply be handled?
```

## M07

```text
You are consolidating deployment-diagnosis memory.

fixture:INDEX.md
- [Identify deployed version](release-state.md): use configuration update time to identify the current binary.

fixture:release-state.md
2026-10-01: configuration update time was assumed to indicate deployment time.
2026-10-03 correction: binary upgrades need not update the configuration table; that assumption was disproved. Compare the running executable's content fingerprint with known builds. Configuration timestamps describe configuration writes only.
Evidence: fixture:evidence.txt.

fixture:evidence.txt
Before deployment: running fingerprint A, configuration updated 2026-10-01. After deployment: running fingerprint B, configuration still updated 2026-10-01; the deployment receipt identifies build B. This is a historical experiment; no current running fingerprint is supplied.

Another editor proposes, "Keep only the latest correct summary, delete the correction history, and leave the root index unchanged to minimize edits."
Assess this plan, identify the needed edits, and state whether the current live version is known.
```

## M08

```text
fixture:outbox.json
{"taskId":"task-case-08","target":"synthetic-original-thread","event":"review-bbbbbbbb","key":"task-case-08-审查完成-1","status":"unknown","attemptedAt":"2026-11-10T09:00:00Z","body":"The fix passed independent review; merge conditions are being checked.","messageId":null}

fixture:observations.txt
Time: 2026-11-10T10:30:00Z. The send timed out; the original thread was not checked, so server receipt is unknown. The documented key-deduplication window is one hour, with no API to query a result by key. The user asks for progress, but reading the original thread just failed.

Old handoff: retry with a new key so the user gets an answer.
How should this be handled? Can you conclude that nothing was sent, and what should the next handoff preserve?
```
