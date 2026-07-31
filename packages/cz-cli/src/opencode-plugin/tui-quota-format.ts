// cz_change: pure presentation logic for the TUI quota indicator. No I/O, no JSX,
// so it is unit-testable on its own and shared by the renderer (tui-quota.tsx)
// and its tests.
import type { QuotaPeriod, QuotaSnapshot } from "./tui-quota-data.js"

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
 * Label distinguishing a daily/weekly/monthly cap from a lifetime one.
 *
 * Rendered as a leading word rather than a trailing "/day": the quota itself is
 * already a `used/limit` pair, so a third slash reads as part of the fraction.
 */
export function periodLabel(period: QuotaPeriod | undefined): string {
  if (period === "daily") return "today "
  if (period === "weekly") return "week "
  if (period === "monthly") return "month "
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

export interface QuotaSegment {
  text: string
  tone: QuotaTone
}

/**
 * Render a snapshot into the segments the indicator draws, left to right.
 *
 * Returns an empty array when there is nothing meaningful to show, which the
 * renderer treats as "occupy no space" — the indicator must be invisible for
 * non-ClickZetta providers rather than showing a placeholder or an error.
 */
export function quotaSegments(snapshot: QuotaSnapshot | undefined): QuotaSegment[] {
  if (!snapshot) return []
  const segments: QuotaSegment[] = []

  if (snapshot.cash !== undefined) {
    segments.push({ text: formatCash(snapshot.cash), tone: cashTone(snapshot.cash, snapshot.owe ?? 0) })
  }

  const { used, limit } = snapshot
  if (used !== undefined && limit !== undefined && limit > 0) {
    // Both numbers, not just a percentage: the user asked to see how much has
    // been consumed alongside the ceiling it counts against.
    segments.push({
      text: `${periodLabel(snapshot.period)}${abbreviate(used)}/${abbreviate(limit)}`,
      tone: quotaTone(remainingRatio(used, limit)),
    })
  }

  return segments
}
