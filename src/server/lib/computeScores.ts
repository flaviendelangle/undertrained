/**
 * Server-side score computation utilities.
 * Pure functions — no runtime dependencies.
 */
import { resolveTimeline } from "../../utils/resolveTimeline";

/**
 * TRIMP gender-specific weighting constants (Banister, 1991).
 *
 * The Banister TRIMP model weights each minute of exercise by a factor that
 * grows exponentially with heart-rate reserve (%HRR). The two constants
 * `a` and `b` control the shape of that exponential curve and differ between
 * sexes because of observed differences in the blood-lactate / HR
 * relationship:
 *
 * - **Male**:   weight = 0.64 · e^(1.92 · %HRR)
 * - **Female**: weight = 0.86 · e^(1.67 · %HRR)
 *
 * Only the male constants are used here.
 */
const TRIMP_A = 0.64;
const TRIMP_B = 1.92;

export interface HrssSettings {
  restingHr: number;
  maxHr: number;
  lthr: number;
}

/**
 * Calculates **HRSS** (Heart Rate Stress Score) from a heart-rate stream
 * and the rider's HR profile settings.
 *
 * HRSS is a normalised form of Banister's TRIMP that is scaled so that
 * **one hour at LTHR produces a score of 100** — the same convention used by
 * power-based TSS.
 *
 * @param hrStream   Heart-rate samples aligned with the time stream.
 * @param settings   Rider settings containing `restingHr`, `maxHr`, and `lthr`.
 * @param timeStream Optional per-sample time offsets (seconds). When provided,
 *                   actual time deltas are used instead of assuming 1 s per sample.
 * @returns          The HRSS value (unitless, TSS-equivalent scale).
 */
export function calculateHRSS(
  hrStream: number[],
  settings: HrssSettings,
  timeStream?: number[],
): number {
  const { restingHr, maxHr, lthr } = settings;
  const hrRange = maxHr - restingHr;

  if (hrRange <= 0 || hrStream.length === 0) {
    return 0;
  }

  const hrrAtFtp = Math.max(0, Math.min(1, (lthr - restingHr) / hrRange));
  const oneHourFtpTrimp =
    hrrAtFtp * TRIMP_A * Math.exp(TRIMP_B * hrrAtFtp) * 60;

  if (oneHourFtpTrimp === 0) {
    return 0;
  }

  let exerciseTrimp = 0;

  for (let i = 0; i < hrStream.length; i++) {
    const hr = hrStream[i];
    if (!Number.isFinite(hr)) continue;

    // Use actual time delta when time stream is available, else assume 1 s
    let dtSeconds: number;
    if (timeStream && i > 0) {
      dtSeconds = timeStream[i] - timeStream[i - 1];
      if (dtSeconds <= 0 || !Number.isFinite(dtSeconds)) continue;
    } else {
      dtSeconds = 1;
    }

    const dtMinutes = dtSeconds / 60;
    const hrr = Math.max(0, Math.min(1, (hr - restingHr) / hrRange));
    exerciseTrimp += dtMinutes * hrr * TRIMP_A * Math.exp(TRIMP_B * hrr);
  }

  return (exerciseTrimp / oneHourFtpTrimp) * 100;
}

/**
 * Calculates TSS (Training Stress Score) from activity metadata.
 */
export function calculateTSS(
  weightedAverageWatts: number,
  movingTime: number,
  ftp: number,
): number {
  if (ftp <= 0 || movingTime <= 0) return 0;
  const intensityFactor = weightedAverageWatts / ftp;
  return (
    ((movingTime * weightedAverageWatts * intensityFactor) / (ftp * 3600)) * 100
  );
}

/**
 * Calculates **rTSS** (Running Training Stress Score) from a velocity stream.
 *
 * Uses Normalized Graded Pace (NGP): 4th root of the mean of 4th powers
 * of 30-second rolling average speeds (analogous to NP for cycling).
 *
 * rTSS = (duration × NGP × IF) / (thresholdPace × 3600) × 100
 * where IF = NGP / thresholdPace
 */
export function calculateRunningTSS(
  velocityStream: number[],
  timeStream: number[],
  thresholdPace: number, // m/s
): number {
  if (thresholdPace <= 0 || velocityStream.length === 0) return 0;

  // Expand to per-second data
  const speeds = expandToPerSecond(velocityStream, timeStream);
  if (speeds.length === 0) return 0;

  const durationSeconds = speeds.length;
  const WINDOW = 30;

  // Compute 30-second rolling averages
  const rollingAvg: number[] = [];
  if (speeds.length < WINDOW) {
    // If activity is shorter than 30s, use overall average
    const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    rollingAvg.push(avg);
  } else {
    let windowSum = 0;
    for (let i = 0; i < WINDOW; i++) {
      windowSum += speeds[i];
    }
    rollingAvg.push(windowSum / WINDOW);
    for (let i = WINDOW; i < speeds.length; i++) {
      windowSum += speeds[i] - speeds[i - WINDOW];
      rollingAvg.push(windowSum / WINDOW);
    }
  }

  // NGP = 4th root of mean of 4th powers
  let sumFourthPowers = 0;
  for (const v of rollingAvg) {
    const v2 = v * v;
    sumFourthPowers += v2 * v2;
  }
  const ngp = Math.pow(sumFourthPowers / rollingAvg.length, 0.25);

  const intensityFactor = ngp / thresholdPace;
  return (
    ((durationSeconds * ngp * intensityFactor) / (thresholdPace * 3600)) * 100
  );
}

/**
 * Calculates **sTSS** (Swimming Training Stress Score).
 *
 * sTSS = IF³ × hours × 100
 *
 * Uses IF cubed (not squared) because water resistance grows cubically
 * with speed. No normalization needed since pool swimming is steady-state.
 */
export function calculateSwimmingTSS(
  distance: number, // meters
  movingTime: number, // seconds
  thresholdPace: number, // m/s
): number {
  if (thresholdPace <= 0 || movingTime <= 0 || distance <= 0) return 0;

  const averageSpeed = distance / movingTime;
  const intensityFactor = averageSpeed / thresholdPace;
  const hours = movingTime / 3600;

  return intensityFactor * intensityFactor * intensityFactor * hours * 100;
}

/**
 * Headline power-curve durations (seconds) that the UI surfaces as chips
 * (mirroring Strava's power best-effort list). Always included when within
 * range, even if the regular stepping would skip them (e.g. 45 min).
 */
const HEADLINE_POWER_DURATIONS = [
  5, 15, 30, 60, 120, 180, 300, 480, 600, 900, 1200, 1800, 2700, 3600, 7200,
  10800,
];

/**
 * Generates power curve duration points (in seconds) up to maxDuration.
 *
 * - Every second from 1s to 30s
 * - Every 5s from 35s to 300s (5 min)
 * - Every 30s from 330s to 1200s (20 min)
 * - Every 120s from 1320s to 3600s (1 h)
 * - Every 300s from 3900s onwards
 * - Plus the headline durations above (so UI chips always have a data point)
 */
export function generatePowerCurveDurations(maxDuration: number): number[] {
  const durations = new Set<number>();

  for (let d = 1; d <= Math.min(30, maxDuration); d += 1) durations.add(d);
  for (let d = 35; d <= Math.min(300, maxDuration); d += 5) durations.add(d);
  for (let d = 330; d <= Math.min(1200, maxDuration); d += 30) durations.add(d);
  for (let d = 1320; d <= Math.min(3600, maxDuration); d += 120) durations.add(d);
  for (let d = 3900; d <= maxDuration; d += 300) durations.add(d);
  for (const d of HEADLINE_POWER_DURATIONS) {
    if (d <= maxDuration) durations.add(d);
  }

  return [...durations].sort((a, b) => a - b);
}

/**
 * Expands a sparse stream (with time offsets) into a per-second array by
 * holding each value until the next sample. Returns the input unchanged
 * if no time stream is provided.
 */
function expandToPerSecond(
  values: number[],
  timeStream: number[],
): number[] {
  if (values.length === 0) return [];

  const totalSeconds = timeStream[timeStream.length - 1] + 1;
  const result = new Array<number>(totalSeconds);

  let srcIdx = 0;
  for (let t = 0; t < totalSeconds; t++) {
    // Advance to the latest sample at or before time t
    while (srcIdx + 1 < timeStream.length && timeStream[srcIdx + 1] <= t) {
      srcIdx++;
    }
    const v = values[srcIdx];
    result[t] = Number.isFinite(v) ? v : 0;
  }

  return result;
}

/**
 * Computes the maximum average power for each target duration
 * using a sliding window over a per-second watts stream.
 * Durations are generated dynamically based on stream length.
 *
 * @param wattsStream  Watts samples aligned with the time stream.
 * @param timeStream   Optional per-sample time offsets (seconds). When
 *                     provided, the stream is expanded to true per-second
 *                     data before applying the sliding window.
 */
export function computePowerBests(
  wattsStream: number[],
  timeStream?: number[],
): Record<number, number> {
  const watts = toPerSecond(wattsStream, timeStream);
  const result: Record<number, number> = {};
  for (const [duration, avg] of maxWindowAverages(watts)) {
    result[duration] = Math.round(avg);
  }
  return result;
}

/**
 * Computes the maximum average heart rate (bpm) sustained over each target
 * duration, from a `heartrate` stream — the HR equivalent of the power curve.
 * Same durations as {@link computePowerBests}.
 */
export function computeHeartrateBests(
  hrStream: number[],
  timeStream?: number[],
): Record<number, number> {
  const hr = toPerSecond(hrStream, timeStream);
  const result: Record<number, number> = {};
  for (const [duration, avg] of maxWindowAverages(hr)) {
    result[duration] = Math.round(avg);
  }
  return result;
}

/**
 * Computes the fastest time (seconds) to cover each target distance (meters),
 * from the cumulative `distance` stream and aligned `time` stream — the cycling
 * equivalent of Strava's distance best efforts (which the API doesn't expose).
 *
 * Uses a two-pointer sweep: both streams are monotonic, so for each start index
 * the end index only moves forward. Distances longer than the ride are skipped.
 */
export function computeSpeedEfforts(
  distanceStream: number[],
  timeStream: number[],
  targetDistances: number[],
): Record<number, number> {
  const result: Record<number, number> = {};
  const n = distanceStream.length;
  if (n < 2 || timeStream.length !== n) return result;

  const total = distanceStream[n - 1] - distanceStream[0];

  for (const target of targetDistances) {
    if (total < target) continue;

    let best = Infinity;
    let j = 0;
    for (let i = 0; i < n; i++) {
      if (j < i) j = i;
      while (j < n && distanceStream[j] - distanceStream[i] < target) j++;
      if (j >= n) break;
      const elapsed = timeStream[j] - timeStream[i];
      if (elapsed > 0 && elapsed < best) best = elapsed;
    }

    if (best < Infinity) result[target] = Math.round(best);
  }

  return result;
}

/**
 * Detects the biggest single climb (meters) from an `altitude` stream, in the
 * spirit of Strava's climb detection: a climb is a sustained ascent that tolerates
 * descents that are small relative to what's already been climbed, and ends only
 * once you drop far enough below its running peak. Returns the largest such climb's gain.
 *
 * The descent tolerance is adaptive: a long col can swallow a 30–40 m dip mid-ascent
 * (a village, a false-flat descent) and still count as one climb, while two genuinely
 * separate hills — divided by a descent large compared to the first one's gain — stay
 * split. A flat absolute tolerance can't do both: too low and big climbs get chopped at
 * every dip, too high and adjacent small hills get merged.
 */
export function computeBiggestClimb(altitudeStream: number[]): number {
  const alt = altitudeStream.filter((v) => Number.isFinite(v));
  if (alt.length < 2) return 0;

  let best = 0;
  let baseAlt = alt[0]; // valley where the current climb started
  let peakAlt = alt[0]; // highest point reached in the current climb

  for (let i = 1; i < alt.length; i++) {
    const a = alt[i];
    // A descent ends the climb once it exceeds a floor AND a fraction of the gain
    // so far: the more you've climbed, the bigger the dip you can ride through.
    const tolerance = Math.max(
      CLIMB_DESCENT_MIN_DROP,
      CLIMB_DESCENT_FRACTION * (peakAlt - baseAlt),
    );
    if (a > peakAlt) {
      peakAlt = a;
    } else if (peakAlt - a > tolerance) {
      // Dropped far enough below the peak → the climb has ended; bank it.
      best = Math.max(best, peakAlt - baseAlt);
      baseAlt = a;
      peakAlt = a;
    } else if (a < baseAlt) {
      // Still drifting down before any real ascent → lower the valley.
      baseAlt = a;
      peakAlt = a;
    }
  }

  best = Math.max(best, peakAlt - baseAlt);
  return Math.round(best);
}

/** A descent only ends a climb once it drops at least this many meters below the peak (noise floor). */
const CLIMB_DESCENT_MIN_DROP = 25;
/** ...or this fraction of the elevation already gained in the current climb, whichever is larger. */
const CLIMB_DESCENT_FRACTION = 0.2;

/** Expands a sparse stream to per-second values (filtering NaN) when a matching time stream is present. */
function toPerSecond(values: number[], timeStream?: number[]): number[] {
  return timeStream?.length === values.length
    ? expandToPerSecond(values, timeStream)
    : values.map((v) => (Number.isFinite(v) ? v : 0));
}

/**
 * For each generated power-curve duration, yields the maximum average value of
 * a per-second series over a sliding window of that length.
 */
function* maxWindowAverages(
  values: number[],
): Generator<[duration: number, average: number]> {
  const durations = generatePowerCurveDurations(values.length);

  for (const duration of durations) {
    if (values.length < duration) continue;

    let windowSum = 0;
    for (let i = 0; i < duration; i++) {
      windowSum += values[i];
    }
    let maxSum = windowSum;

    for (let i = duration; i < values.length; i++) {
      windowSum += values[i] - values[i - duration];
      if (windowSum > maxSum) {
        maxSum = windowSum;
      }
    }

    yield [duration, maxSum / duration];
  }
}

interface ResolvedSettings {
  ftp: number;
  weightKg: number;
  restingHr: number;
  maxHr: number;
  lthr: number;
  runThresholdPace: number;
  swimThresholdPace: number;
}

const DEFAULT_RESOLVED_SETTINGS: ResolvedSettings = {
  ftp: 200,
  weightKg: 75,
  restingHr: 50,
  maxHr: 185,
  lthr: 163,
  runThresholdPace: 0,
  swimThresholdPace: 0,
};

interface SettingsTimeline {
  initialValues: { [K in keyof ResolvedSettings]?: ResolvedSettings[K] | null };
  changes: ({ date: string } & Partial<ResolvedSettings>)[];
}

/**
 * Resolves rider settings for a specific date by walking the change timeline.
 * Missing or null initial values are filled with sensible defaults.
 */
export function resolveRiderSettings(
  timeline: SettingsTimeline,
  targetDate: string,
): ResolvedSettings {
  const fullInitialValues: ResolvedSettings = { ...DEFAULT_RESOLVED_SETTINGS };
  for (const key of Object.keys(DEFAULT_RESOLVED_SETTINGS) as (keyof ResolvedSettings)[]) {
    const v = timeline.initialValues[key];
    if (v != null) {
      fullInitialValues[key] = v;
    }
  }
  return resolveTimeline(fullInitialValues, timeline.changes, targetDate);
}
