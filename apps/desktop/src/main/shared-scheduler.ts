export type ScheduledWork = () => unknown | Promise<unknown>;

type Job = {
  key: string;
  dueAt: number;
  work: ScheduledWork;
};

export type SchedulerStats = {
  scheduled: number;
  queued: number;
  active: number;
  peakActive: number;
  completed: number;
  failed: number;
  timerCount: 0 | 1;
};

/**
 * A single-clock scheduler for every headless task. It deliberately keeps the
 * network work outside the clock callback, caps concurrent work, and catches
 * failures per job so one task cannot stop the rest of the queue.
 */
export class SharedScheduler {
  private readonly jobs = new Map<string, Job>();
  private readonly ready: Job[] = [];
  private timer: NodeJS.Timeout | undefined;
  private timerDueAt = Number.POSITIVE_INFINITY;
  private active = 0;
  private peakActive = 0;
  private completed = 0;
  private failed = 0;

  constructor(
    private readonly concurrency = 16,
    private readonly onError: (key: string, error: unknown) => void = () => undefined,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Scheduler concurrency must be at least one.");
  }

  schedule(key: string, delayMs: number, work: ScheduledWork): void {
    this.remove(key);
    const job = { key, dueAt: Date.now() + Math.max(0, delayMs), work };
    this.jobs.set(key, job);
    if (!this.timer || job.dueAt < this.timerDueAt) this.arm();
  }

  cancel(key: string): void {
    const dueAt = this.jobs.get(key)?.dueAt;
    this.remove(key);
    if (dueAt != null && dueAt <= this.timerDueAt) this.arm();
  }

  cancelPrefix(prefix: string): void {
    for (const key of [...this.jobs.keys()]) if (key.startsWith(prefix)) this.jobs.delete(key);
    for (let index = this.ready.length - 1; index >= 0; index -= 1) {
      if (this.ready[index]?.key.startsWith(prefix)) this.ready.splice(index, 1);
    }
    this.arm();
  }

  shutdown(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.timerDueAt = Number.POSITIVE_INFINITY;
    this.jobs.clear();
    this.ready.length = 0;
  }

  stats(): SchedulerStats {
    return {
      scheduled: this.jobs.size,
      queued: this.ready.length,
      active: this.active,
      peakActive: this.peakActive,
      completed: this.completed,
      failed: this.failed,
      timerCount: this.timer ? 1 : 0,
    };
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.timerDueAt = Number.POSITIVE_INFINITY;
    if (!this.jobs.size) return;
    let nextDueAt = Number.POSITIVE_INFINITY;
    for (const job of this.jobs.values()) nextDueAt = Math.min(nextDueAt, job.dueAt);
    this.timerDueAt = nextDueAt;
    this.timer = setTimeout(() => this.collectDue(), Math.max(0, nextDueAt - Date.now()));
  }

  private collectDue(): void {
    this.timer = undefined;
    this.timerDueAt = Number.POSITIVE_INFINITY;
    const now = Date.now();
    for (const [key, job] of this.jobs) {
      if (job.dueAt > now) continue;
      this.jobs.delete(key);
      this.ready.push(job);
    }
    this.ready.sort((left, right) => left.dueAt - right.dueAt);
    this.arm();
    this.pump();
  }

  private remove(key: string): void {
    this.jobs.delete(key);
    const queued = this.ready.findIndex((job) => job.key === key);
    if (queued >= 0) this.ready.splice(queued, 1);
  }

  private pump(): void {
    while (this.active < this.concurrency && this.ready.length) {
      const job = this.ready.shift();
      if (!job) break;
      this.active += 1;
      this.peakActive = Math.max(this.peakActive, this.active);
      void Promise.resolve()
        .then(job.work)
        .then(() => { this.completed += 1; })
        .catch((error: unknown) => {
          this.failed += 1;
          this.onError(job.key, error);
        })
        .finally(() => {
          this.active -= 1;
          this.pump();
        });
    }
  }
}
