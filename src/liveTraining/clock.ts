/** A timer started through a {@link Clock}, for cancelling it. */
export type TimerId = ReturnType<typeof setTimeout> | number;

/**
 * Time as the ride engine sees it. Injected, so a test can ride a whole
 * workout without waiting for one.
 */
export interface Clock {
  /** Monotonic milliseconds. Every duration in a ride is measured on it. */
  now(): number;
  /** Epoch milliseconds, for the timestamps a recording carries. */
  epoch(): number;
  setTimeout(callback: () => void, ms: number): TimerId;
  /** Does nothing for a null id, or a timer that already fired. */
  clearTimeout(id: TimerId | null): void;
  setInterval(callback: () => void, ms: number): TimerId;
  clearInterval(id: TimerId | null): void;
}

/**
 * The page's clock. `performance.now()` rather than `Date.now()` for
 * durations: a wall clock that jumps (NTP, a laptop waking up) would otherwise
 * move the ride clock with it. The globals are looked up on every call, so
 * fake timers installed after import still apply.
 */
export const browserClock: Clock = {
  now: () => performance.now(),
  epoch: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (id) => clearTimeout(id ?? undefined),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (id) => clearInterval(id ?? undefined),
};
