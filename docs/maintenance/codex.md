# Codex maintenance service

The external `cz-cli-maintainer` project owns the controller implementation, tests and deployment. This repository keeps maintenance docs, AGENTS.md and the independent Action AI review. Do not add controller code or an executable compatibility wrapper here.

When the operator parks historical work, persist `intakeAfter` as a timezone-qualified ISO timestamp in private runtime `config.json`. The external controller admits only source events updated at or after that boundary; new replies in older threads still qualify. Preserve existing historical events and task records with explicit deferred dispositions, put active old tasks in `needs_attention` and cancel their one-shot followups. A startup wake or recurring timer does not authorize resuming, delivering, releasing or cleaning up parked tasks. New feedback or explicit user authorization is required to revisit them.

The supervisor owns wakeups; Codex performs bounded rounds. Keep the existing `cz-maintenance` runtime, intake acknowledgements, tasks, claims, worktrees, outbox and release receipts. `control/service.sqlite` adds scheduling and background-delegate job state (`delegates` table), not a second task or delivery ledger. WAL transactions deduplicate wakeups, batch a role's pending events, admit at most one foreground role round at a time while running up to `maxConcurrentDelegates` (default `2`, strictly at most `1` per task) isolated background delegates concurrently, and pre-compile a redacted `WakeBriefing` packet into each round prompt.

## Configuration and deployment

Keep a dedicated private `CODEX_HOME`, with only the selected provider/model and credentials. Never copy another project's hooks, MCP servers, sessions or machine-specific paths. Set `native.scheduleMode` to `codex-service` and `native.codex` in private runtime `config.json` (optional heterogeneous reviewer/challenger routing may be configured via `native.reviewModel`, `native.challengeModel`, or `native.review.consensus` for dual-model consensus gates on sensitive paths):

```json
{
  "binary": "/usr/local/bin/codex",
  "home": "/absolute/private/codex-home",
  "model": "YOUR_CONFIGURED_MODEL",
  "sandbox": "danger-full-access",
  "timeoutSeconds": 3600,
  "supervision": {
    "run": "/usr/bin/systemd-run",
    "control": "/usr/bin/systemctl",
    "unit": "cz-maintenance.service",
    "environmentFile": "/absolute/private/service.env"
  }
}
```

The sandbox is explicit: unattended execution uses `approval_policy="never"`; repository runtime permissions still govern external actions. The existing maintenance authorization permits full host access. A workspace-only sandbox requires separate writable roots for runtime, worktrees and tool state; do not silently broaden it when a command fails. Disable client-private auto-memory in this dedicated home. Credentials and transcripts never enter Git.

Before takeover, stop legacy Claude loops, Monitor consumers and interactive maintenance writers. Preserve their full handoff and dedicated transcript directory. Confirm `codex login status`, then run a bounded, read-only `codex exec --json` against the actual configured model and endpoint; a local config file is not authentication evidence.

Install the reviewed external controller in a versioned directory, with its `controller/current` symlink selecting the deployed controller commit. The external project's `deploy/cz-maintenance.service` supplies the unit: keep `WorkingDirectory` on the product control checkout and set `ExecStart` to the absolute external `current/src/cli.ts`. Install `cz-maintenance` on operator and service PATH, invoking that external entrypoint; it accepts `--repo /absolute/control/checkout` when called elsewhere. Keep runtime identity in the target checkout's existing Git common directory, including when it is a linked worktree.

Put existing GitHub/Lark/tool environment in private `service.env` (mode 0600); provider credentials belong in the Codex home. Preserve tool paths and Git SSH routing when adding the command directory to PATH. Keep `CODEX_HOME` out of the environment file so each round uses the explicit configured home. Verify user lingering, `systemd-analyze --user verify`, then `systemctl --user daemon-reload` and `systemctl --user enable --now cz-maintenance`. `KillMode=control-group` terminates all children if the daemon crashes, including detached tool processes. Every model round also runs in its own transient service, bound to the parent unit, with a runtime deadline and control-group cleanup. Each production round revalidates its configured parent-unit binding; an invalid hot reload stops the daemon and pauses the role. The executor confirms that unit stopped before admitting another round; uncertain cleanup stops the parent. Parent-only process-group cleanup cannot contain a tool that calls `setsid()`.

On startup and before each provider round the clean product control checkout fast-forwards to `origin/main`. Read synchronization respects the operator's Git and proxy configuration; the separate push guard still requires a direct connection. Product rule updates do not change the external controller version or restart it. Deploying a controller update requires its own reviewed commit and an explicit stopped-service version switch. Dirty, divergent or non-main product control checkouts fail closed. No source edits belong there.

## Operating commands

Run from the control checkout:

```sh
cz-maintenance service status
cz-maintenance status --status running --limit 20
cz-maintenance claim TASK_ID --owner worker-round-1 --note 'Triaging and preparing worktree'
cz-maintenance worktree TASK_ID --branch fix-auth-race
cz-maintenance task-patch TASK_ID --json '{"status":"running","phase":"implement"}' --increment-attempts
cz-maintenance delegate dispatch TASK_ID --kind implement --worktree /abs/worktree --prompt-file brief.md
cz-maintenance delegate list --task TASK_ID
cz-maintenance service pause worker 'Maintenance window; stop after the active round'
cz-maintenance wait TASK_ID --pr 240 --head "$PR_HEAD_SHA" --checks --reason 'Wait for PR #240 CI completion'
cz-maintenance unwait TASK_ID
cz-maintenance challenge TASK_ID hypothesis.md
cz-maintenance review TASK_ID 240
cz-maintenance release-claim TASK_ID --owner worker-round-1
cz-maintenance memory eval M01
cz-maintenance ops friction record intake-timeout friction.json
cz-maintenance ops digest
cz-maintenance service followup task-ci-HEAD worker 2026-12-01T10:00:00Z 'Recheck TASK CI and preserve the original request'
cz-maintenance service cancel task-ci-HEAD
cz-maintenance service resume worker 'Checked writers, task worktrees, PR/release state and reply receipts; safe to continue'
```

Followups use stable unique IDs, an explicit timezone and a concrete reconciliation condition. Creating the same definition twice preserves its original deadline, even after it fired; use a new ID for a new check. Conflicting definitions fail. Cancellation removes an unclaimed wakeup, and cannot undo a round already running. Missed recurring periods coalesce into one wakeup after downtime, rather than replaying every elapsed interval.

`pause` prevents the next role round; it does not interrupt the active one. `systemctl --user stop cz-maintenance` stops the daemon and active model/tools. Stop, terminal provider failures, timeouts and crash recovery pause affected roles before replay. Owner checks include boot and process-start identity, so unrelated processes that reuse a saved PID cannot block recovery. Restart does not clear pauses. Inspect private `control/runs/RUN_ID/{prompt.txt,events.jsonl,stderr.log,response.txt}`, task worktrees and outgoing receipts; reconcile all possible side effects, then resume with an evidence-based note. Exceptions before or during execution also retain a private `error.json` in that run directory; its existence alone does not mean a model started. Startup and scheduler exceptions retain `control/service-error.json`. Diagnostics redact known environment credentials, provider/proxy URLs and bearer values. Do not change keys or fabricate success to evade failure. Source scans continue while roles are paused.

Codex 0.167.1 JSONL reports recoverable stream-reconnection notices as `error`, omitting the retry flag. A later `turn.completed` in that same execution, exit zero, a nonempty final response and confirmed isolation cleanup establish success; the notice remains in the private transcript. `turn.failed`, malformed protocol output, a new unfinished turn, an error after the last completion, nonzero exit, interruption or uncertain cleanup still fail closed. The controller never launches another execution to recover such a notice. This follows the pinned CLI's final-status behavior and the [documented terminal events](https://learn.chatgpt.com/docs/non-interactive-mode), rather than matching error-message wording.

The scan interval is one minute, Worker reconciliation five minutes and Curator curation daily. Idle Worker ticks do not invoke a model. The first source failure atomically records one durable Worker investigation wake per outage; repeated failed scans do not keep waking the model, and recovery rearms this notification. Source scans and model execution have separate health records. A failed source read leaves its intake untouched and allows other scheduling to continue; private `control/intake-SOURCE-error.json` retains its last diagnostic, with known environment credentials and bearer values redacted. Polling replaces the previous expiring native listeners; no Feishu long-connection or immediate-response claim follows from successful polling. A pending item remains in the original intake until the Worker explicitly acknowledges its disposition.

Every round starts a fresh context. Read AGENTS, the role prompt, `WakeBriefing`, relevant topic notes, handoff, tasks and original feedback. Synchronous subagents started inside a round must finish before the round ends; cross-round background work must be dispatched exclusively via `cz-maintenance delegate dispatch` (which runs under controller supervision and wakes the Worker on completion). Register external CI/PR/issue waits as zero-token subscriptions (`cz-maintenance wait TASK ...`) or durable `service followup` timers; never leave unmanaged model-owned listeners or background writers across rounds. Curator reads new run transcripts and historical Claude transcripts, preserving separate coverage cursors and private evidence.

## Acceptance and rollback

Run `bun test` and `bun typecheck` in the external controller project, then independent review of its exact commit and the repository boundary change. Action review has its own checks in `.github/scripts`. On Linux verify real authentication, both intake sources, singleton ownership, clean stop with no surviving children, restart with persisted timers and explicit interrupted-run reconciliation. Confirm the external CLI resolves the original runtime from the target checkout, that historical state is preserved and that product updates do not reload controller code. Keep actual logs and separate product/controller deployment SHAs in private runtime records. Natural input-to-reply acceptance requires actual traffic and receipts; never send diagnostic Feishu messages.

Before rollout pause the next rounds, let active work finish and reconcile its effects. Stop the daemon and scanners, persist the original business manifest and a consistent SQLite backup, then switch only the external executable/unit. Do not move or recreate the control clone, runtime or historical task worktrees. Start paused, compare the protected state and verify sources before resuming. Record both the deployed controller commit and product baseline. SQLite and all original intake/task/outbox records are preserved on rollback. Stop the unit before switching controller versions. Reconcile interrupted work before restoring a previous runtime; never run Claude loops alongside the Codex service. AI review has its own workflow/configuration and must be validated separately.

## AI review

The historical workflow file `claude-review.yml` now runs Codex. Configure private `CODEX_REVIEW_API_KEY` and `CODEX_REVIEW_BASE_URL` secrets, plus the `CODEX_REVIEW_MODEL` repository variable, before enabling it. A Responses endpoint needs its version prefix (typically `/v1`); Claude's client adds that prefix itself, while Codex appends `/responses` to its configured base URL. Verify the actual gateway route instead of assuming the same raw string works for both clients.

The `pull_request_target` event keeps the workflow definition on the trusted base; manual dispatch uses the selected trusted branch. The workflow executes its runner from that base revision, then reviews a detached worktree at the immutable PR head. It does not run PR code or tests, and marks the source untrusted so project configuration cannot replace the review policy. Before Codex starts, it removes runner sudo access. A named permission profile grants read access only to system tool paths, the trusted checkout and reviewed source, with no command network access. Provider files remain outside those readable roots, and the model process receives no GitHub token. Named profiles must not be combined with legacy `--sandbox`, which overrides them. These boundaries follow the [official permission-profile guidance](https://learn.chatgpt.com/docs/permissions) and [Codex Action privilege guidance](https://learn.chatgpt.com/docs/github-action).

Structured output must match the reviewed SHA and changed or deleted diff lines (`side: "RIGHT"` for added/modified `+` lines, `side: "LEFT"` for deleted `-` lines; `path` uses the destination `b/` path on both `RIGHT` and `LEFT` sides for added, modified, and renamed-with-edits files, and the old `a/` path only for deleted files, while pure renames expose no inline diff lines and belong in `summary`). Every pull request triggers the workflow and classifies the immutable full `base...head` PR diff before installing Codex: when the full PR diff touches only ordinary documentation (`docs/**/*.{md,mdx,txt}` outside `docs/maintenance/**`, `packages/docs/**/*.{md,mdx,txt}`, package `README`/`CHANGELOG`/`CONTRIBUTING` files, or root `*.{md,mdx}` other than `AGENTS.md`, `CLAUDE.md`, `.github/codex-review-prompt.md`, and `.github/claude-review-context.md`), the workflow skips cleanly without invoking the model, while still reviewing `docs/maintenance/**` runbooks/prompts, `packages/cz-cli/UPSTREAM-PATCHES.md`, shipped runtime `.txt` prompts, `.opencode/**` tools, and code PRs whose latest commit updated documentation. The host checks decoded publication strings for private configuration, verifies the PR still has the reviewed head and base, and posts one review containing inline findings. A marker deduplicates repeat delivery for that base/head pair; ambiguous writes are reconciled before retry. Reviews remain advisory and never replace independent final-SHA review or required tests. Full model transcripts are not published to Actions logs or artifacts; private runner state is removed at job end.

Run a manual dry run on a same-repository, non-draft PR to verify credentials, schema and line mapping without posting a review. Set `candidate_model` to test a new model before changing `CODEX_REVIEW_MODEL`. The override applies only to that dry run, which has its own concurrency group so the PR's regular review can finish.

Merge the trusted runner before enabling the workflow and confirm it with a real Actions run. The prior Claude informational exception does not exempt the Codex workflow.
