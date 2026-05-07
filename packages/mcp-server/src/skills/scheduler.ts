/**
 * Hourly scheduler for automatic skill updates.
 *
 * Python → TS mapping:
 *   scheduler.py:12-185  HourlyScheduler class  → HourlyScheduler class
 *   scheduler.py:52-65   _calculate_next_hour() → _calculateNextHour()
 *   scheduler.py:67-82   _calculate_seconds_until() → _calculateSecondsUntil()
 *   scheduler.py:84-139  _schedule_loop()       → _scheduleLoop()
 *   scheduler.py:141-149 start()                → start()
 *   scheduler.py:151-166 stop()                 → stop()
 *   scheduler.py:168-185 get_status()           → getStatus()
 */

import { logger } from "../logger.js"

// ---------------------------------------------------------------------------
// scheduler.py:12-185 — HourlyScheduler class
// ---------------------------------------------------------------------------

export class HourlyScheduler {
  readonly intervalMinutes: number
  private readonly updateCallback: () => Promise<void>
  private _timer: ReturnType<typeof setTimeout> | null = null
  private _running = false
  nextRunTime: Date | null = null
  lastRunTime: Date | null = null

  constructor(intervalMinutes: number, updateCallback: () => Promise<void>) {
    this.intervalMinutes = intervalMinutes
    this.updateCallback = updateCallback
  }

  // scheduler.py:52-65 — _calculate_next_hour()
  private _calculateNextHour(): Date {
    const now = new Date()
    // Round up to next hour (scheduler.py:62-64)
    const next = new Date(now)
    next.setHours(next.getHours() + 1, 0, 0, 0)
    return next
  }

  // scheduler.py:67-82 — _calculate_seconds_until()
  private _calculateSecondsUntil(targetTime: Date): number {
    const now = Date.now()
    const delta = (targetTime.getTime() - now) / 1000
    return Math.max(0, delta)
  }

  // scheduler.py:84-139 — _schedule_loop() (adapted for Node setTimeout)
  private async _scheduleLoop(): Promise<void> {
    logger.info("Hourly scheduler started")

    // Calculate time until next exact hour for first run (scheduler.py:89-95)
    this.nextRunTime = this._calculateNextHour()
    const secondsUntilFirst = this._calculateSecondsUntil(this.nextRunTime)

    logger.info(
      {
        nextRunTime: this.nextRunTime.toISOString(),
        minutesUntil: (secondsUntilFirst / 60).toFixed(1),
      },
      "First update check scheduled",
    )

    // Wait until first exact hour (scheduler.py:98)
    await this._sleep(secondsUntilFirst * 1000)

    // Main loop (scheduler.py:101-138)
    while (this._running) {
      try {
        logger.info({ now: new Date().toISOString() }, "Running scheduled update check")
        this.lastRunTime = new Date()

        await this.updateCallback()

        // Calculate next run time (scheduler.py:112-119)
        const nextMs = Date.now() + this.intervalMinutes * 60 * 1000
        this.nextRunTime = new Date(nextMs)
        // Align to exact hour if interval is 60 minutes (scheduler.py:116-119)
        if (this.intervalMinutes === 60) {
          this.nextRunTime.setMinutes(0, 0, 0)
        }

        const secondsUntilNext = this._calculateSecondsUntil(this.nextRunTime)

        logger.info(
          {
            nextRunTime: this.nextRunTime.toISOString(),
            minutesUntil: (secondsUntilNext / 60).toFixed(1),
          },
          "Next update check scheduled",
        )

        await this._sleep(secondsUntilNext * 1000)
      } catch (e) {
        if (!this._running) break // cancelled
        const err = e instanceof Error ? e : new Error(String(e))
        logger.error({ err }, "Error in scheduler loop")
        // Wait a bit before retrying (scheduler.py:137)
        await this._sleep(60_000)
      }
    }

    logger.info("Hourly scheduler stopped")
  }

  // Promise-based sleep that can be interrupted by stop()
  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this._timer = setTimeout(resolve, ms)
    })
  }

  // scheduler.py:141-149 — start()
  start(): void {
    if (this._running) {
      logger.warn("Scheduler already running")
      return
    }

    this._running = true
    // Fire-and-forget; errors are caught inside _scheduleLoop
    void this._scheduleLoop()
    logger.info("Scheduler task created")
  }

  // scheduler.py:151-166 — stop()
  async stop(): Promise<void> {
    if (!this._running) return

    logger.info("Stopping scheduler...")
    this._running = false

    if (this._timer !== null) {
      clearTimeout(this._timer)
      this._timer = null
    }

    logger.info("Scheduler stopped")
  }

  // scheduler.py:168-185 — get_status()
  getStatus(): Record<string, unknown> {
    return {
      running: this._running,
      interval_minutes: this.intervalMinutes,
      next_run_time: this.nextRunTime?.toISOString() ?? null,
      last_run_time: this.lastRunTime?.toISOString() ?? null,
    }
  }
}
