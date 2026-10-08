# SQL cancellation ownership

Killing a shell process does not cancel the SQL it submitted. `execSql` owns a
remote job from before submission until terminal confirmation or an explicit
asynchronous handoff. This includes a HYBRID submission that has not returned.

## No upstream patches

All supervision lives in `packages/cz-cli`; transport cancellation lives in the
ClickZetta SDK. There are no changes to opencode, Core, TUI, their tools or their
plugin APIs. No command rewriting, stdout parsing or global shell interception
is used.

The cz agent bootstrap starts a loopback TCP supervisor before importing the
agent runtime. Its endpoint and random capability are passed in `CZ_SQL_CLEANUP`.
The existing cz Worker environment bridge copies them into the TUI server Worker;
upstream shell tools inherit the current environment through their existing
process runner. A separate connection owns each SQL job, so concurrent commands
and sessions do not share job ownership. Remote servers use the supervisor on the
machine actually executing their CLI subprocesses, not the attached client.

If the supervisor cannot start, non-SQL tools can still run. The environment
explicitly marks supervision unavailable and SQL admission fails closed. An
unwritable diagnostic destination only drops unconfirmed-cleanup records; it
does not withdraw supervision. A missing inherited environment (for example after an
explicit `env -i`) uses standalone CLI behavior; it cannot promise supervisor
recovery.

## Protocol and recovery

Before submitting anything, a SQL process connects, sends its capability, job ID,
credential snapshot, endpoint and timeout, and waits for acknowledgement. Each
connection accepts one job. Registration failure prevents submission. Frames are
newline-delimited JSON, limited to 64 KiB, with at most 256 connections/cleanup
operations. Credentials remain in memory and never enter the command line, disk
or diagnostic output. Registration and control operations are scoped to the
connection; one connection cannot release another job.

The child sends a heartbeat every second and expects replies. Disconnect triggers
supervisor cancellation immediately; a 10-second heartbeat lease handles frozen
processes or a connection that does not close promptly. The child also aborts
execution if it loses its supervisor. An independent supervisor deadline bounds
a job even while heartbeats continue. Both ends use monotonic elapsed time.

Cancellation validates business status and polls for a terminal state. HTTP
success alone is insufficient. Missing/unsubmitted jobs are not terminal proof:
cleanup repeats cancellation to cover delayed submission visibility. Execution
cancellation stops HTTP, credential waits and submit/poll retries; cleanup uses a
fresh signal with an independent total budget.

A child unregisters after confirmed completion/cancellation. `--async` explicitly
hands off ownership only after acknowledgement. Losing that acknowledgement
fails the command and attempts cancellation rather than reporting a successful
handoff. Disconnect after a successful handoff does not cancel the detached job.

| Boundary                | Budget                                        |
| ----------------------- | --------------------------------------------- |
| Credential resolution   | Query deadline only (may refresh a token)     |
| Registration handshake  | 2 seconds, also subject to the query deadline |
| Child cleanup           | 1.5 seconds per job, concurrently             |
| Signal shutdown         | Hard 2-second exit bound                      |
| Supervisor cleanup      | 5 seconds per job, concurrently               |
| Heartbeat expiry        | 10 seconds, checked every second              |
| Handoff acknowledgement | 1 second                                      |

Supervisor cleanup is asynchronous relative to the upstream shell result. A shell
may return before cancellation is confirmed; this design deliberately makes no
claim that shell return proves remote queue release. Unconfirmed cleanup records
job ID and sanitized reason in `~/.clickzetta/sql-cleanup.jsonl`, without writing
into a terminal owned by the TUI renderer. Normal bootstrap return closes the
supervisor and attempts cancellation of all outstanding registrations.

## Timeout compatibility and limits

Standalone `cz-cli sql` retains its default 300-second timeout and now actively
cancels on timeout, SIGINT or SIGTERM. Positive explicit timeouts are sent to the
server, including for `--async`; the 300-second default is not, because it bounds
waiting rather than a detached job. Invalid/non-positive CLI timeout values fail
at the command boundary (except `--job-profile`, which submits nothing); zero is
not an unlimited-timeout sentinel.

Interruption errors name their cause: a deadline is `Job <id> timed out`
(`JOB_TIMEOUT`), a signal is `ABORTED`, a lost supervisor is
`SQL_SUPERVISOR_LOST`. The signal envelope keeps `job_id` and adds `job_ids`
when several jobs were active. `cancelJob` treats a 2xx without a populated error
status as accepted; confirmation still comes from polling job state.

Standalone `execSql` callers without a timeout (such as table/schema/file commands)
keep their previous deployment-defined timeout. They still clean up on caught
failure and signals. Agent-supervised calls without an explicit timeout receive
a 300-second fallback (not sent to the server for `--async` handoff). No upstream hook exposes the shell's remaining budget, so
supervision uses the SQL deadline plus disconnect/heartbeat detection instead.

If the entire agent is killed, loses network access, or the credential snapshot
expires, immediate cancellation is not guaranteed. A finite server timeout is
the final fallback for supervised jobs. Ordinary coordinator jobs check timeout
from submission across queued and running states; deployed behavior still needs
live validation. Continuous jobs have different semantics. Cancellation cannot
undo completed writes and is not transaction rollback. No durable recovery is
introduced.

Tests use real sockets, HTTP servers and subprocesses for SIGINT/SIGTERM/SIGKILL,
submit/poll races, heartbeat expiry, healthy heartbeats, connection isolation,
failed admission/handoff, bounded cleanup, bootstrap bundling, Worker environment
inheritance and the unchanged upstream process runner. CLI tests cover timeout
validation and defaults. Windows signal behavior and live deployment recovery
require environment-specific validation.
