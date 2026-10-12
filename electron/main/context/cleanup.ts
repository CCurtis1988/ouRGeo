export interface LocalCleanupJob {
  id: string
  scope: string
  namespace: string
  generation: number
  attempts: number
  nextAttemptAt: number
  state: 'pending' | 'needs-review' | 'removed'
}

interface CleanupHost {
  jobs: () => Promise<LocalCleanupJob[]>
  remove: (namespace: string) => Promise<void>
  complete: (job: LocalCleanupJob, success: boolean, now: number) => Promise<void>
  now?: () => number
}

/** Only private rebuildable files are removed. No credentials, remote calls or
 * native execution are needed, even for a disconnected scope. A generation
 * receipt prevents an older purge from acknowledging a newer forgetting. */
export class LocalCleanupRunner {
  private active: Promise<void> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private wakeAgain = false
  constructor(private host: CleanupHost) {}
  wake(): void {
    if (this.stopped) return
    if (this.active) { this.wakeAgain = true; return }
    clearTimeout(this.timer)
    this.active = this.run().catch(() => {
      // Keep the durable jobs intact when protected storage is unavailable.
      this.schedule(60_000)
    }).finally(() => {
      this.active = undefined
      if (this.wakeAgain) { this.wakeAgain = false; this.wake() }
    })
  }
  async flush(): Promise<void> { this.wake(); await this.active }
  stop(): void { this.stopped = true; clearTimeout(this.timer) }
  private schedule(delay: number): void {
    if (this.stopped) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.wake(), Math.max(100, delay))
    this.timer.unref?.()
  }
  private async run(): Promise<void> {
    const now = this.host.now ?? Date.now
    const jobs = await this.host.jobs()
    for (const job of jobs.filter(job => job.state === 'pending' && job.nextAttemptAt <= now()).slice(0, 32)) {
      if (this.stopped) return
      let success = false
      try { await this.host.remove(job.namespace); success = true }
      catch { /* The persisted retry receipt names the recovery move in settings. */ }
      await this.host.complete(job, success, now())
    }
    if (this.stopped) return
    const remaining = (await this.host.jobs()).filter(job => job.state === 'pending')
    if (remaining.length) this.schedule(Math.min(...remaining.map(job => job.nextAttemptAt)) - now())
  }
}
