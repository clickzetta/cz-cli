# OAuth session recovery

ClickZetta rotates its refresh token on every successful exchange. Reusing an old
refresh token can revoke the entire session, including the replacement token.

The CLI records each refresh attempt durably **before** sending it. Processes
sharing the same local state reuse the successful result instead of submitting
the same refresh token again. This also applies when profiles share or copy the
same OAuth credentials. Ordinary API requests can still run concurrently; a 401
can adopt another process's replacement access token before attempting a refresh.

## When a command cannot refresh

| Error                     | What to do                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `LOCK_CONTENDED`          | Another process is updating local state. Retry the command after it finishes.                            |
| `OAUTH_REFRESH_PENDING`   | A refresh has started. Retry later; if its process exited, run `cz-cli auth login <name>`.               |
| `OAUTH_REFRESH_UNCERTAIN` | The issuer may have consumed the token without a durably saved response. Run `cz-cli auth login <name>`. |
| `OAUTH_STATE_UNAVAILABLE` | Check permissions and free space in `~/.clickzetta`, then retry.                                         |
| `SESSION_EXPIRED`         | The issuer rejected the refresh token. Run `cz-cli auth login <name>`.                                   |

A crashed or paused refresher is never automatically replaced by another sender.
Even a crash immediately before the HTTP request may therefore require login.
Without an issuer-supported idempotency or recovery protocol, the CLI cannot
know whether repeating a lost request would revoke the session.

Do not delete `oauth-state.sqlite3` to clear an error. A new login establishes new
credentials while retaining the old token fingerprints that prevent replay.

## State, upgrades and backups

- `~/.clickzetta/profiles.toml` holds configuration and OAuth import seeds. It may
  contain a compatibility copy of the latest token, but is not the authoritative
  refresh history.
- `~/.clickzetta/oauth-state.sqlite3` holds the latest credentials and the durable
  refresh history. It is created with mode `0600`. Retired token values are removed
  from live rows; their SHA-256 fingerprints remain to prevent later reuse. This
  is logical removal, not forensic erasure of backups or disk pages.
- All processes sharing credentials must use this implementation and the same
  database on a local filesystem with working SQLite locking and durability.
  Restart long-running CLI, agent and MCP processes together when upgrading.
  Mixing old binaries with new ones, sharing credentials across independent
  databases/machines, or using a filesystem without those guarantees is unsupported.
- Stop all participating processes before backing up both files together. Restoring
  an old backup or downgrading can restore consumed credentials: sign in afresh
  before using that restored state. Copying only `profiles.toml` to another machine
  does not transfer replay protection; log in separately on that machine.

This design assumes an old access token produces an ordinary authentication error,
without revoking its refresh-token family. If the issuer revokes the family merely
for using an old access token, refresh exclusion alone is insufficient: all resource
requests must also participate in a server-aware session coordination protocol.

## SDK store implementations

The SDK stays independent of SQLite. Custom `TokenStore` implementations provide
`refresh(previous, request)` in addition to `load`, `save`, `clear` and `withLock`.
`refresh` must durably admit the token before invoking `request`, invoke it at most
once across cooperating processes, and persist the replacement before returning.
It must never recover an unknown outcome by resending the old token. `withLock`
only coalesces local work; a compare-and-swap after HTTP does not provide this guarantee.

SDK callers without a persistent store retain process-local coordination only.
