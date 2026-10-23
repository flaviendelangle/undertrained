export const log = (...args: unknown[]) => console.log("[ANT+]", ...args);
export const logError = (...args: unknown[]) =>
  console.error("[ANT+]", ...args);

// Singleton stick instance shared between HR and power sensors.
// A new instance must be created after close() since the AbortController is single-use.
let sharedStick: import("ant-plus-next").WebUsbStick | null = null;
let stickReady = false;
let stickOpenPromise: Promise<import("ant-plus-next").WebUsbStick> | null =
  null;
let stickRefCount = 0;
/**
 * Connections that have acquired the stick but have not finished attaching
 * yet. They are not in `stickRefCount` — a reference is only taken once
 * `attach()` has returned — so without counting them separately, one sensor's
 * failed attach would see a refcount of 0 and close the stick out from under
 * another sensor that is still handshaking on it.
 */
let stickPendingCount = 0;

/** How long to wait for the stick's startup handshake. */
const STARTUP_TIMEOUT_MS = 10_000;

/**
 * Creates a stick and resolves once it has completed its startup handshake.
 *
 * The "startup" listener MUST be attached before calling open(), because
 * open() blocks forever on success (readLoop is infinite).
 */
async function openStick(): Promise<import("ant-plus-next").WebUsbStick> {
  const { WebUsbStick } = await import("ant-plus-next");
  const stick = new WebUsbStick();

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error("ANT+ startup timeout after 10s — stick did not handshake"),
      );
    }, STARTUP_TIMEOUT_MS);

    stick.on("startup", () => {
      clearTimeout(timeout);
      log("Startup handshake complete");
      resolve();
    });

    stick.on("shutdown", () => {
      log("Stick shutdown");
      // The stick is gone; force the next acquire to build a fresh one.
      if (sharedStick === stick) {
        sharedStick = null;
        stickReady = false;
      }
    });

    log("Opening stick...");
    // open() returns true on success but only AFTER readLoop ends (never in
    // normal operation). open() returns false on error. We don't await it — we
    // wait for the "startup" event instead.
    stick.open().then(
      (result) => {
        if (!result) {
          clearTimeout(timeout);
          reject(
            new Error(
              "stick.open() returned false — connection failed. Check browser console for details.",
            ),
          );
        }
      },
      (err) => {
        clearTimeout(timeout);
        logError("stick.open() threw:", err);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });

  return stick;
}

/**
 * Returns the shared, opened stick.
 *
 * Concurrent callers share a single in-flight open. Creating a second
 * `WebUsbStick` while the first was still handshaking used to leave the later
 * caller attached to a stick that had never been opened, because the earlier
 * stick's "startup" event flipped the shared ready flag.
 */
export async function acquireStick(): Promise<
  import("ant-plus-next").WebUsbStick
> {
  if (sharedStick && stickReady) return sharedStick;

  if (!stickOpenPromise) {
    stickOpenPromise = openStick().then(
      (stick) => {
        sharedStick = stick;
        stickReady = true;
        stickOpenPromise = null;
        return stick;
      },
      (err: unknown) => {
        sharedStick = null;
        stickReady = false;
        stickOpenPromise = null;
        throw err;
      },
    );
  }

  return stickOpenPromise;
}

function closeStick(): void {
  log("All sensors disconnected, closing stick");
  void sharedStick?.close();
  sharedStick = null;
  stickReady = false;
  stickOpenPromise = null;
}

/** Nobody is using the stick, and nobody is in the middle of claiming it. */
function closeStickIfIdle(): void {
  if (stickRefCount === 0 && stickPendingCount === 0 && sharedStick) {
    closeStick();
  }
}

/**
 * Marks the start of a connect attempt, before the stick has been acquired.
 *
 * Must be paired with exactly one `endStickUse()` on every exit path,
 * including the ones that throw.
 */
export function beginStickUse(): void {
  stickPendingCount++;
}

/**
 * Marks the end of a connect attempt. `kept` is true only when the connection
 * completed `attach()` and is taking a reference — see `holdsStick` on each
 * connection class. Counting an aborted connect, or a `disconnect()` on a
 * sensor that never connected, would either strand the stick open (leaving the
 * WebUSB device claimed until the browser restarts) or close it out from under
 * the other sensor.
 */
export function endStickUse(kept: boolean): void {
  stickPendingCount = Math.max(0, stickPendingCount - 1);
  if (kept) {
    stickRefCount++;
    return;
  }
  closeStickIfIdle();
}

/** Releases one reference to the shared stick. */
export function releaseStick(): void {
  stickRefCount = Math.max(0, stickRefCount - 1);
  closeStickIfIdle();
}
