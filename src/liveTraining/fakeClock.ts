import type { Clock, TimerId } from "./clock";

interface Timer {
  at: number;
  /** The period of an interval; null for a timeout. */
  every: number | null;
  callback: () => void;
}

/**
 * A clock for tests that only moves when told to. Timers fire in due order,
 * each with the clock set to its due time, so a callback reading `now()` sees
 * exactly the moment it was scheduled for.
 */
export class FakeClock implements Clock {
  private time = 0;
  private nextId = 1;
  private readonly timers = new Map<number, Timer>();
  /** Where `epoch()` starts, so recorded timestamps look like real ones. */
  readonly epochOrigin = Date.UTC(2026, 9, 1, 7);

  now = () => this.time;
  epoch = () => this.epochOrigin + this.time;

  setTimeout = (callback: () => void, ms: number): TimerId =>
    this.add({ at: this.time + ms, every: null, callback });

  setInterval = (callback: () => void, ms: number): TimerId =>
    this.add({ at: this.time + ms, every: ms, callback });

  clearTimeout = (id: TimerId | null) => {
    if (id != null) this.timers.delete(id as number);
  };

  clearInterval = this.clearTimeout;

  /** Moves time forward by `ms`, firing every timer that falls due. */
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      let dueId: number | null = null;
      let due: Timer | null = null;
      // Map iteration is in insertion order, so ties go to the older timer.
      for (const [id, timer] of this.timers) {
        if (timer.at <= end && (due == null || timer.at < due.at)) {
          dueId = id;
          due = timer;
        }
      }
      if (dueId == null || due == null) break;
      // An overdue timer (see `stall`) fires late, once, and an interval
      // carries on from when it actually fired.
      this.time = Math.max(this.time, due.at);
      if (due.every == null) this.timers.delete(dueId);
      else due.at = this.time + due.every;
      due.callback();
    }
    this.time = end;
  }

  /**
   * Moves time forward without firing anything, the way a background tab
   * holds its timers back. The next `advance()` fires each overdue timer once.
   */
  stall(ms: number): void {
    this.time += ms;
  }

  private add(timer: Timer): number {
    const id = this.nextId++;
    this.timers.set(id, timer);
    return id;
  }
}
