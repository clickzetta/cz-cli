/**
 * NotifyScheduledExecutor ported from clickzetta/connector/common/notify_executor.py.
 * Provides delayed task scheduling with notification support.
 */

export interface DelayedTask<T = unknown> {
  runTimeMs: number
  task: () => T | Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
  notify: boolean
}

/**
 * Executor service that supports scheduled tasks with notification.
 * Uses setTimeout-based scheduling (single-threaded JS equivalent of Python's thread pool).
 */
export class NotifyScheduledExecutor {
  readonly name: string
  private _tasks: DelayedTask[] = []
  private _timers: Set<ReturnType<typeof setTimeout>> = new Set()
  private _stopped = false
  private _exception: Error | null = null

  constructor(name: string, _corePoolSize = 4) {
    this.name = name
  }

  get isStopped(): boolean {
    return this._stopped
  }

  /**
   * Schedule a task with a delay in milliseconds.
   * @returns A promise that resolves with the task result.
   */
  addTask<T>(task: () => T | Promise<T>, delayMs: number): Promise<T> {
    if (this._stopped) throw new Error(`NotifyScheduledExecutor ${this.name} is stopped`)
    if (this._exception) throw this._exception

    return new Promise<T>((resolve, reject) => {
      const delayed: DelayedTask<T> = {
        runTimeMs: Date.now() + delayMs,
        task,
        resolve: resolve as (value: unknown) => void,
        reject,
        notify: false,
      }
      this._tasks.push(delayed as DelayedTask)

      const timer = setTimeout(async () => {
        this._timers.delete(timer)
        await this._executeTask(delayed as DelayedTask)
      }, delayMs)
      this._timers.add(timer)
    })
  }

  /**
   * Notify all scheduled tasks to run immediately.
   */
  notifyAllScheduledTasks(): void {
    // Clear existing timers
    for (const timer of this._timers) clearTimeout(timer)
    this._timers.clear()

    // Mark all tasks for immediate execution and run them
    const pending = [...this._tasks]
    this._tasks = []
    for (const task of pending) {
      task.notify = true
      this._executeTask(task)
    }
  }

  /**
   * Shutdown the executor.
   */
  close(): void {
    this._stopped = true
    this.notifyAllScheduledTasks()
    for (const timer of this._timers) clearTimeout(timer)
    this._timers.clear()
    if (this._exception) throw this._exception
  }

  private async _executeTask(delayed: DelayedTask): Promise<void> {
    // Remove from pending list
    const idx = this._tasks.indexOf(delayed)
    if (idx >= 0) this._tasks.splice(idx, 1)

    try {
      const result = await delayed.task()
      delayed.resolve(result)
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      this._exception = err
      delayed.reject(err)
    }
  }
}
