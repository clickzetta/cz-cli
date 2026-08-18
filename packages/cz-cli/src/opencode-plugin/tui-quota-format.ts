// cz_change: pure presentation logic for the TUI quota indicator. No I/O, no JSX,
// so it is unit-testable on its own and shared by the renderer (tui-quota.tsx)
// and its tests.
import type { ProfileInfo, QuotaPeriod, QuotaSnapshot } from "./tui-quota-data.js"

/** Theme color token the indicator asks for. Resolved against api.theme.current. */
export type QuotaTone = "text" | "textMuted" | "success" | "warning" | "error"

/**
 * Abbreviate a token count the way the prompt's own context counter does
 * (packages/tui/src/util/locale.ts `number`). Reimplemented rather than imported:
 * @opencode-ai/tui is private and not a cz-cli dependency, and this keeps the
 * bundled module free of any packages/tui import.
 */
export function abbreviate(value: number): string {
  if (!Number.isFinite(value)) return "?"
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(Math.round(value))
}

/** Format a CNY amount. Two decimals, ¥-prefixed, no thousands separator noise. */
export function formatCash(amount: number): string {
  return `¥${amount.toFixed(2)}`
}

/**
 * Phrase distinguishing a daily/weekly/monthly cap from a lifetime one, empty for
 * a lifetime cap since "10.1M / 10.0M tokens" already says everything then.
 *
 * A trailing phrase rather than a "/day" suffix: the figure is already a
 * `used / limit` pair, so a third slash would read as part of the fraction.
 */
export function periodSuffix(period: QuotaPeriod | undefined): string {
  if (period === "daily") return " today"
  if (period === "weekly") return " this week"
  if (period === "monthly") return " this month"
  return ""
}

/**
 * Fraction of the quota still available, clamped to 0..1.
 *
 * Clamping matters: a complimentary key can report usage ABOVE its ceiling
 * (observed 10,082,801 against a 10,000,000 cap), which would otherwise yield a
 * negative ratio and fall through numeric comparisons unpredictably.
 */
export function remainingRatio(used: number, limit: number): number {
  if (!(limit > 0)) return 0
  return Math.min(1, Math.max(0, 1 - used / limit))
}

/**
 * Map remaining quota to a color. Graduated so the number changes appearance
 * well before it runs out, with red reserved for the last 10% — the point at
 * which the user needs to top up to keep working.
 */
export function quotaTone(remaining: number): QuotaTone {
  if (remaining < 0.1) return "error"
  if (remaining < 0.25) return "warning"
  return "textMuted"
}

/**
 * Tone for the cash balance. Owing anything already blocks job submission, so
 * that outranks a low-but-positive balance.
 */
export function cashTone(cash: number, owe = 0): QuotaTone {
  if (owe > 0) return "error"
  if (cash <= 0) return "error"
  if (cash < 10) return "warning"
  return "textMuted"
}

export interface QuotaRow {
  text: string
  tone: QuotaTone
}

/**
 * Render a snapshot into the sidebar's rows, top to bottom.
 *
 * One labelled figure per line, matching the Context section it sits under
 * (packages/tui/src/feature-plugins/sidebar/context.tsx renders "12,345 tokens" /
 * "3% used" / "$0.01 spent" the same way). The trailing word is what makes a bare
 * number readable in a 42-column column, so it is part of the text rather than a
 * separate label the caller has to supply.
 *
 * Returns an empty array when there is nothing meaningful to show, which the
 * renderer treats as "draw no section at all" — better than a heading over
 * placeholder figures for a user on a non-ClickZetta provider.
 */
export function quotaRows(snapshot: QuotaSnapshot | undefined): QuotaRow[] {
  if (!snapshot) return []
  const rows: QuotaRow[] = []

  if (snapshot.cash !== undefined) {
    rows.push({ text: `${formatCash(snapshot.cash)} balance`, tone: cashTone(snapshot.cash, snapshot.owe ?? 0) })
  }

  const { used, limit } = snapshot
  if (used !== undefined && limit !== undefined && limit > 0) {
    const tone = quotaTone(remainingRatio(used, limit))
    // Both numbers, not just a percentage: seeing the ceiling is what tells you
    // whether the percentage is worth acting on.
    rows.push({ text: `${abbreviate(used)} / ${abbreviate(limit)} tokens${periodSuffix(snapshot.period)}`, tone })
    rows.push({ text: `${formatPercentLeft(remainingRatio(used, limit))} left`, tone })
  }

  return rows
}

/**
 * Percentage still available, floored so a nearly-spent quota never rounds up to a
 * reassuring figure — 0.4% remaining reads as "0%", not "1%".
 */
export function formatPercentLeft(remaining: number): string {
  return `${Math.floor(remaining * 100)}%`
}

/**
 * Render the active profile into sidebar rows: who this session is connected as,
 * and where.
 *
 * These are the facts that answer "am I about to run this against the right
 * lakehouse", which is worth a glance before every prompt — so they are plain
 * `text` tone rather than muted, unlike the figures below them.
 *
 * Account and user are separate rows because they are separate things and their
 * values look alike (`xxjrdhjr` the tenant vs `xh123` the person); a single
 * combined line invites reading one as the other. Missing fields drop their row
 * rather than printing a placeholder.
 */
export function profileRows(info: ProfileInfo | undefined): QuotaRow[] {
  if (!info) return []
  const rows: QuotaRow[] = [
    { text: info.authType ? `${info.profile} · ${info.authType}` : info.profile, tone: "text" },
  ]
  const add = (value: string | undefined, label: string) => {
    if (value) rows.push({ text: `${value} ${label}`, tone: "textMuted" })
  }
  add(info.accountName, "account")
  add(info.userName, "user")
  add(info.region, "region")
  add(info.instance, "instance")
  add(info.workspace, "workspace")
  return rows
}
