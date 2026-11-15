# Codex maintenance service

The supervisor owns wakeups; Codex performs bounded rounds. Keep the existing `cz-maintenance` runtime, intake acknowledgements, tasks, claims, worktrees, outbox and release receipts. `control/service.sqlite` adds scheduling state, not a second task or delivery ledger. WAL transactions deduplicate wakeups, batch a role's pending events and admit at most one provider round across both roles. New input during a round waits for the next one.

## Configuration and deployment

Keep a dedicated private `CODEX_HOME`, with only the selected provider/model and credentials. Never copy another project's hooks, MCP servers, sessions or machine-specific paths. Set `native.scheduleMode` to `codex-service` and `native.codex` in private runtime `config.json`:

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

Install [the user service](../../scripts/maintenance/cz-maintenance.service), adapting absolute Bun/checkout paths if necessary. Put existing GitHub/Lark/tool environment in its private `service.env` (mode 0600); provider credentials belong in the Codex home. Keep `CODEX_HOME` out of that environment file so each round uses the explicit configured home. Verify user lingering, `systemd-analyze --user verify`, then `systemctl --user daemon-reload` and `systemctl --user enable --now cz-maintenance`. Use this supervisor for deployment: `KillMode=control-group` terminates all children if the daemon crashes, including detached tool processes. Every model round also runs in its own transient service, bound to the parent unit, with a runtime deadline and control-group cleanup. Each production round revalidates its configured parent-unit binding; an invalid hot reload stops the daemon and pauses the role. The executor confirms that unit stopped before admitting another round; uncertain cleanup stops the parent. Parent-only process-group cleanup cannot contain a tool that calls `setsid()`. A bare shell process is not equivalent supervision.

On startup and before each provider round the clean control checkout fast-forwards to `origin/main`. A changed commit defers pending events and exits, so systemd restarts with the new code. Dirty, divergent or non-main control checkouts fail closed. No source edits belong there.

## Operating commands

Run from the control checkout:

```sh
bun scripts/maintenance.ts service status
bun scripts/maintenance.ts service pause worker 'Maintenance window; stop after the active round'
bun scripts/maintenance.ts service followup task-ci-HEAD worker 2026-12-01T10:00:00Z 'Recheck TASK CI and preserve the original request'
bun scripts/maintenance.ts service cancel task-ci-HEAD
bun scripts/maintenance.ts service resume worker 'Checked writers, task worktrees, PR/release state and reply receipts; safe to continue'
```

Followups use stable unique IDs, an explicit timezone and a concrete reconciliation condition. Creating the same definition twice preserves its original deadline, even after it fired; use a new ID for a new check. Conflicting definitions fail. Cancellation removes an unclaimed wakeup, and cannot undo a round already running. Missed recurring periods coalesce into one wakeup after downtime, rather than replaying every elapsed interval.

`pause` prevents the next role round; it does not interrupt the active one. `systemctl --user stop cz-maintenance` stops the daemon and active model/tools. Stop, provider errors, timeouts and crash recovery pause affected roles before replay. Owner checks include boot and process-start identity, so unrelated processes that reuse a saved PID cannot block recovery. Restart does not clear pauses. Inspect private `control/runs/RUN_ID/{prompt.txt,events.jsonl,stderr.log,response.txt}`, task worktrees and outgoing receipts; reconcile all possible side effects, then resume with an evidence-based note. Do not change keys or fabricate success to evade failure. Source scans continue while roles are paused.

The scan interval is one minute, Worker reconciliation five minutes and Curator curation daily. Idle Worker ticks do not invoke a model. The first source failure atomically records one durable Worker investigation wake per outage; repeated failed scans do not keep waking the model, and recovery rearms this notification. Source scans and model execution have separate health records. Polling replaces the previous expiring native listeners; no Feishu long-connection or immediate-response claim follows from successful polling. A pending item remains in the original intake until the Worker explicitly acknowledges its disposition.

Every round starts a fresh context. Read AGENTS, the role prompt, relevant topic notes, handoff, tasks and original feedback. Pass these entrypoints to bounded delegates, read all final results and save unfinished progress before ending. Schedule waits as followups; do not leave model-owned listeners or delegates across rounds. Curator reads new run transcripts and historical Claude transcripts, preserving separate coverage cursors and private evidence.

## Acceptance and rollback

Run maintenance unit tests and tools typecheck from `packages/cz-cli`, then independent review of the exact head. On Linux verify real authentication, both intake sources, singleton ownership, clean stop with no surviving children, restart with persisted timers and explicit interrupted-run reconciliation. Keep actual logs and release/deployment SHAs in private runtime records. Natural input-to-reply acceptance requires actual traffic and receipts; never send diagnostic Feishu messages.

Before rollout back up runtime configuration and record the deployed commit. SQLite and all original intake/task/outbox records are preserved on rollback. Stop the new unit before changing code or credentials. Reconcile interrupted work before restoring a previous runtime; never run Claude loops alongside the Codex service. AI review has its own workflow/configuration and must be validated separately.

## AI review

The historical workflow file `claude-review.yml` now runs Codex. Configure private `CODEX_REVIEW_API_KEY` and `CODEX_REVIEW_BASE_URL` secrets, plus the `CODEX_REVIEW_MODEL` repository variable, before enabling it. A Responses endpoint needs its version prefix (typically `/v1`); Claude's client adds that prefix itself, while Codex appends `/responses` to its configured base URL. Verify the actual gateway route instead of assuming the same raw string works for both clients.

The `pull_request_target` event keeps the workflow definition on the trusted base; manual dispatch uses the selected trusted branch. The workflow executes its runner from that base revision, then reviews a detached worktree at the immutable PR head. It does not run PR code or tests, and marks the source untrusted so project configuration cannot replace the review policy. Before Codex starts, it removes runner sudo access. A named permission profile grants read access only to system tool paths, the trusted checkout and reviewed source, with no command network access. Provider files remain outside those readable roots, and the model process receives no GitHub token. Named profiles must not be combined with legacy `--sandbox`, which overrides them. These boundaries follow the [official permission-profile guidance](https://learn.chatgpt.com/docs/permissions) and [Codex Action privilege guidance](https://learn.chatgpt.com/docs/github-action).

Structured output must match the reviewed SHA and added/changed lines. The host checks decoded publication strings for private configuration, verifies the PR still has the reviewed head and base, and posts one review containing inline findings. A marker deduplicates repeat delivery for that base/head pair; ambiguous writes are reconciled before retry. Reviews remain advisory and never replace independent final-SHA review or required tests. Full model transcripts are not published to Actions logs or artifacts; private runner state is removed at job end.

Use the workflow's manual dispatch with a PR number and `dry_run: true` to validate credentials, schema and line mapping without posting. Fork and draft PRs are excluded. Deployment must merge the trusted runner before enabling the new workflow; its first PR cannot run a runner absent from its base revision. Confirm a real Actions run after enabling it. The prior Claude informational exception does not exempt the renamed Codex workflow.
