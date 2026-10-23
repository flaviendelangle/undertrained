/**
 * The per-second time base for Strava streams, shared by server-side scoring
 * and the activity page so both read a recording the same way.
 *
 * Strava keeps one entry per recorded sample: every second on a 1 Hz
 * recording, every few seconds with smart recording, and with a jump across a
 * pause. The `time` stream holds each sample's offset from the start, in
 * seconds. Putting a stream on the per-second time base holds each sample
 * until the next one.
 */

/** True when a time stream is 0, 1, 2, …, so its samples already are one per second. */
export function isOneHertz(timeStream: readonly number[]): boolean {
  return timeStream.every((t, i) => t === i);
}

/**
 * For each second from the start to the last sample, the index of the latest
 * sample at or before it.
 */
export function perSecondSampleIndices(
  timeStream: readonly number[],
): number[] {
  if (timeStream.length === 0) return [];

  const totalSeconds = timeStream[timeStream.length - 1] + 1;
  const result = new Array<number>(totalSeconds);

  let srcIdx = 0;
  for (let t = 0; t < totalSeconds; t++) {
    // Advance to the latest sample at or before time t
    while (srcIdx + 1 < timeStream.length && timeStream[srcIdx + 1] <= t) {
      srcIdx++;
    }
    result[t] = srcIdx;
  }

  return result;
}

/**
 * Expands a sparse stream (with time offsets) into a per-second array by
 * holding each value until the next sample. Non-finite values become 0.
 */
export function expandToPerSecond(
  values: readonly number[],
  timeStream: readonly number[],
): number[] {
  if (values.length === 0) return [];

  return perSecondSampleIndices(timeStream).map((srcIdx) => {
    const v = values[srcIdx];
    return Number.isFinite(v) ? v : 0;
  });
}
