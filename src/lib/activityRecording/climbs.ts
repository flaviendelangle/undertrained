export interface DetectedClimb {
  startIndex: number;
  endIndex: number;
  distance: number;
  gain: number;
  grade: number;
  category: "3" | "2" | "1" | "HC";
}

interface ProfilePoint {
  distance: number;
  altitude: number;
  index: number;
}

// Garmin's published ClimbPro categories use length (m) × average grade (%).
// Cat 3 starts above 16,000, with at least 500 m and 3% average grade:
// https://www8.garmin.com/manuals-apac/webhelp/edge840/EN-SG/GUID-105BE189-9D31-4686-A0A5-94D84F347A23-821.html
const MIN_SCORE = 16_000;
const MIN_DISTANCE = 500;
const MIN_GRADE = 3;
const SAMPLE_DISTANCE = 25;
const MAX_RESAMPLED_POINTS = 20_000;
const MIN_DROP = 20;
const DROP_FRACTION = 0.1;

/**
 * Detect substantial valley-to-summit climbs, in recording order. Distance-based
 * median smoothing removes isolated altitude spikes. Hysteresis bridges small
 * dips. Flats stay inside a climb while the overall grade qualifies; a significant
 * descent or a flat/shallow tail that dilutes the grade ends it at its last
 * qualifying peak.
 * These boundary heuristics are ours; Garmin publishes categories, not its full
 * extraction algorithm. Categorization uses smoothed net gain, never accumulated
 * GPS noise. Returned indices still refer to the original, untouched recording.
 */
export function detectClimbs(
  altitude: number[],
  distance: number[] | null,
): DetectedClimb[] {
  if (distance?.length !== altitude.length) return [];
  const climbs: DetectedClimb[] = [];
  let run: ProfilePoint[] = [];

  const finishRun = () => {
    if (run.length >= 3) {
      const profile = smoothProfile(run);
      let valley = 0;
      let peak = 0;
      let nextValley = 0;
      let qualifyingPeak: number | null = null;
      const emit = (end = peak) => {
        const a = profile[valley],
          b = profile[end];
        const length = distance[b.index] - distance[a.index];
        const gain = b.altitude - a.altitude;
        const grade = (100 * gain) / length;
        // Algebraically length × grade, without rounding across category cutoffs.
        const score = 100 * gain;
        if (
          length < MIN_DISTANCE ||
          grade < MIN_GRADE ||
          score <= MIN_SCORE ||
          !Number.isFinite(grade) ||
          b.index <= a.index ||
          a.index <= (climbs.at(-1)?.endIndex ?? -1)
        )
          return;
        climbs.push({
          startIndex: a.index,
          endIndex: b.index,
          distance: length,
          gain,
          grade,
          category:
            score > 80_000
              ? "HC"
              : score > 64_000
                ? "1"
                : score > 32_000
                  ? "2"
                  : "3",
        });
      };
      for (let i = 1; i < profile.length; i++) {
        const point = profile[i];
        if (point.altitude <= profile[valley].altitude) {
          // Descending or flat before a climb: start at the latest valley.
          if (peak !== valley) emit();
          valley = peak = nextValley = i;
          qualifyingPeak = null;
          continue;
        }
        const length = distance[point.index] - distance[profile[valley].index];
        const gain = point.altitude - profile[valley].altitude;
        const grade = (100 * gain) / length;
        if (qualifyingPeak != null && grade < MIN_GRADE) {
          emit(qualifyingPeak);
          valley = peak = nextValley = i;
          qualifyingPeak = null;
          continue;
        }
        if (point.altitude > profile[peak].altitude) {
          peak = nextValley = i;
          if (
            length >= MIN_DISTANCE &&
            grade >= MIN_GRADE &&
            100 * gain > MIN_SCORE
          )
            qualifyingPeak = peak;
        } else {
          if (point.altitude <= profile[nextValley].altitude) nextValley = i;
          const gain = profile[peak].altitude - profile[valley].altitude;
          const drop = profile[peak].altitude - point.altitude;
          if (drop >= Math.max(MIN_DROP, gain * DROP_FRACTION)) {
            emit();
            // Restart strictly after the previous peak. No climb can overlap it.
            valley = nextValley > peak ? nextValley : i;
            peak = nextValley = valley;
            qualifyingPeak = null;
          }
        }
      }
      emit();
    }
    run = [];
  };

  for (let i = 0; i < altitude.length; i++) {
    const d = distance[i],
      h = altitude[i];
    if (!Number.isFinite(d) || !Number.isFinite(h) || d < 0) {
      finishRun();
      continue;
    }
    const previous = run.at(-1);
    if (previous && d < previous.distance) finishRun();
    if (run.at(-1)?.distance === d) {
      // Stops must not create vertical climbs or overweight a smoothing window.
      run[run.length - 1] = { distance: d, altitude: h, index: i };
    } else run.push({ distance: d, altitude: h, index: i });
  }
  finishRun();
  return climbs;
}

function smoothProfile(raw: ProfilePoint[]): ProfilePoint[] {
  const first = raw[0].distance,
    last = raw.at(-1)!.distance;
  const step = Math.max(SAMPLE_DISTANCE, (last - first) / MAX_RESAMPLED_POINTS);
  const points: ProfilePoint[] = [];
  let right = 1;
  const count = Math.ceil((last - first) / step);
  for (let k = 0; k <= count; k++) {
    const d = Math.min(last, first + k * step);
    while (right < raw.length - 1 && raw[right].distance < d) right++;
    const a = raw[right - 1],
      b = raw[right];
    const fraction = (d - a.distance) / (b.distance - a.distance);
    points.push({
      distance: d,
      altitude: a.altitude + fraction * (b.altitude - a.altitude),
      index: fraction < 0.5 ? a.index : b.index,
    });
  }
  return points.map((point, i) => {
    const window = points
      .slice(Math.max(0, i - 2), i + 3)
      .map((p) => p.altitude)
      .sort((a, b) => a - b);
    return { ...point, altitude: window[Math.floor(window.length / 2)] };
  });
}
