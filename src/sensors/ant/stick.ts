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
/** What each holder of the stick does if it disappears from under them. */
const stickLossListeners = new Set<() => void>();

/** How long to wait for the stick's startup handshake. */
const STARTUP_TIMEOUT_MS = 10_000;

/**
 * The stick stopped working without us closing it: pulled out, or its read
 * loop died. Every holder is told, so its sensor can be reported gone, and the
 * next acquire builds a fresh stick.
 */
function markStickLost(stick: import("ant-plus-next").WebUsbStick): void {
  // Closed by us, or already reported.
  if (sharedStick !== stick) return;
  log("Stick lost");
  sharedStick = null;
  stickReady = false;
  for (const onLost of [...stickLossListeners]) onLost();
}

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
    let started = false;
    const timeout = setTimeout(() => {
      reject(
        new Error("ANT+ startup timeout after 10s — stick did not handshake"),
      );
    }, STARTUP_TIMEOUT_MS);

    stick.on("startup", () => {
      started = true;
      clearTimeout(timeout);
      log("Startup handshake complete");
      resolve();
    });

    stick.on("shutdown", () => {
      log("Stick shutdown");
      markStickLost(stick);
    });

    log("Opening stick...");
    // open() returns true on success but only AFTER readLoop ends (never in
    // normal operation). open() returns false on error. We don't await it — we
    // wait for the "startup" event instead.
    //
    // Once started, open() settling means the read loop is over. Pulling the
    // stick out ends it with a throw, and the library's own close() then fails
    // detaching the sensors, so open() rejects and "shutdown" never fires.
    stick.open().then(
      (result) => {
        if (started) {
          markStickLost(stick);
        } else if (!result) {
          clearTimeout(timeout);
          reject(
            new Error(
              "stick.open() returned false — connection failed. Check browser console for details.",
            ),
          );
        }
      },
      (err) => {
        if (started) {
          logError("Stick read loop failed:", err);
          markStickLost(stick);
          return;
        }
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
 * How long to wait for the stick to free a channel. A close takes about one
 * message period, a quarter of a second at most; this only guards against a
 * confirmation that never comes.
 */
const CHANNEL_RELEASE_TIMEOUT_MS = 2_000;

/**
 * Detaches `sensor` and resolves once its channel is free to reuse. Use it for
 * every detach: the power meter fallback reuses the trainer's channel at once,
 * and so does a reconnect while another sensor keeps the stick open.
 *
 * The library's `detach()` resolves as soon as the close is written, and the
 * sensor keeps its channel number until the stick has closed the channel and
 * confirmed the unassign that follows, which the library then reports as
 * "detached". Until that point it hands every event on the channel number to
 * every sensor set to it, so a sensor attached there early takes the old
 * one's close and unassign as its own, and drops its channel.
 */
export async function detachAndWaitForChannel(
  sensor: import("ant-plus-next").BaseSensor,
): Promise<void> {
  if (sensor.channel === undefined) return;
  const released = new Promise<void>((resolve) => {
    const release = () => {
      clearTimeout(timeout);
      sensor.removeListener("detached", release);
      resolve();
    };
    const timeout = setTimeout(() => {
      log("Channel close not confirmed, reusing it anyway");
      release();
    }, CHANNEL_RELEASE_TIMEOUT_MS);
    sensor.on("detached", release);
  });
  try {
    await sensor.detach();
  } catch {
    // May already be detached
  }
  await released;
}

/**
 * Gives back the channel of a sensor the library dropped on its own.
 *
 * When a channel loses its device the library unassigns it and says
 * "detached", but never tells the stick, which goes on counting the channel
 * as taken. While another sensor keeps the stick open, every drop and
 * reconnect would use one up, until attach() fails with "Maximum number of
 * channels reached". This is bookkeeping only; nothing is sent to the stick.
 */
export function releaseDroppedChannel(
  stick: import("ant-plus-next").WebUsbStick,
  sensor: Parameters<import("ant-plus-next").WebUsbStick["detach"]>[0],
): void {
  stick.detach(sensor).catch((err: unknown) => {
    logError("Failed to give back a dropped channel:", err);
  });
}

/**
 * Marks the start of a connect attempt, before the stick has been acquired.
 *
 * Must be paired with exactly one `abandonStickUse()` or `holdStick()` on
 * every exit path, including the ones that throw.
 */
export function beginStickUse(): void {
  stickPendingCount++;
}

/**
 * Ends a connect attempt that is not keeping the stick: it failed, or a
 * disconnect() overtook it. Counting it as a reference would strand the stick
 * open, leaving the WebUSB device claimed until the browser restarts.
 */
export function abandonStickUse(): void {
  stickPendingCount = Math.max(0, stickPendingCount - 1);
  closeStickIfIdle();
}

/**
 * Ends a connect attempt whose sensor attached, turning it into a reference
 * to the stick. Only take one once `attach()` has returned: a reference for a
 * connection nobody holds would never be released.
 *
 * If the stick disappears while held, the reference is released and `onLost`
 * runs. Returns the release, which is safe to call more than once, or null
 * when the stick was lost during the attach and no reference was taken.
 */
export function holdStick(
  stick: import("ant-plus-next").WebUsbStick,
  onLost: () => void,
): (() => void) | null {
  stickPendingCount = Math.max(0, stickPendingCount - 1);
  if (sharedStick !== stick) {
    closeStickIfIdle();
    return null;
  }

  stickRefCount++;
  let held = true;
  const release = () => {
    if (!held) return;
    held = false;
    stickLossListeners.delete(handleLoss);
    stickRefCount = Math.max(0, stickRefCount - 1);
    closeStickIfIdle();
  };
  const handleLoss = () => {
    release();
    onLost();
  };
  stickLossListeners.add(handleLoss);
  return release;
}
