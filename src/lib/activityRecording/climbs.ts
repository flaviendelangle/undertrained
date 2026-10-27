export interface DetectedClimb {
  startIndex: number;
  endIndex: number;
  distance: number;
  gain: number;
  grade: number;
  category: "3" | "2" | "1" | "HC";
}

interface Candidate {
  start: number;
  end: number;
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
const MIN_EDGE_DEFICIT = 20;

/**
 * Detect substantial valley-to-summit climbs, in recording order. Distance-based
 * median smoothing removes isolated altitude spikes. Hysteresis bridges small
 * dips. Flats stay inside a climb while the overall grade qualifies; a significant
 * descent or a flat/shallow tail that dilutes the grade ends a tentative section
 * at its last qualifying peak.
 * These boundary heuristics are ours; Garmin publishes categories, not its full
 * extraction algorithm. Tentative sections need Cat 3 length and grade, either
 * as a whole or after edge trimming, but not its score. Group them before final
 * trimming and classification so smaller ramps can still form one climb across
 * a flat or saddle.
 * Categorization uses smoothed net gain, never accumulated
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
      const candidates: Candidate[] = [];
      let valley = 0;
      let peak = 0;
      let nextValley = 0;
      let qualifyingPeak: number | null = null;
      const emit = (end = peak) => {
        const candidate = { start: valley, end };
        // Ramps need Cat 3 length and grade but not its score: smaller ramps
        // can still qualify together across a saddle once grouped.
        let climb = measureClimb(profile, distance, valley, end, 0);
        if (!climb) {
          // A long shallow approach must not hide a qualifying ramp. Retain
          // the original bounds until grouping so trimming cannot discard an
          // approach ramp that only qualifies together with the main ascent.
          const trimmed = trimEdges(profile, candidate, candidate);
          climb = measureClimb(
            profile,
            distance,
            trimmed.start,
            trimmed.end,
            0,
          );
        }
        const previous = candidates.at(-1);
        if (
          climb &&
          climb.startIndex > (previous ? profile[previous.end].index : -1)
        )
          candidates.push(candidate);
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
      climbs.push(...groupClimbs(candidates, profile, distance));
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

function measureClimb(
  profile: ProfilePoint[],
  distance: number[],
  start: number,
  end: number,
  minScore = MIN_SCORE,
): DetectedClimb | null {
  const a = profile[start],
    b = profile[end];
  const length = distance[b.index] - distance[a.index];
  const gain = b.altitude - a.altitude;
  const grade = (100 * gain) / length;
  // Algebraically length × grade, without rounding across category cutoffs.
  const score = 100 * gain;
  if (
    length < MIN_DISTANCE ||
    grade < MIN_GRADE ||
    score <= minScore ||
    !Number.isFinite(grade) ||
    b.index <= a.index
  )
    return null;
  return {
    startIndex: a.index,
    endIndex: b.index,
    distance: length,
    gain,
    grade,
    category:
      score > 80_000 ? "HC" : score > 64_000 ? "1" : score > 32_000 ? "2" : "3",
  };
}

interface ElevationSummary {
  min: number;
  max: number;
  drop: number;
}

function summarize(
  profile: ProfilePoint[],
  start: number,
  end: number,
): ElevationSummary {
  let min = Infinity,
    max = -Infinity,
    drop = 0;
  for (let i = start; i <= end; i++) {
    const altitude = profile[i].altitude;
    min = Math.min(min, altitude);
    max = Math.max(max, altitude);
    drop = Math.max(drop, max - altitude);
  }
  return { min, max, drop };
}

function combine(a: ElevationSummary, b: ElevationSummary): ElevationSummary {
  return {
    min: Math.min(a.min, b.min),
    max: Math.max(a.max, b.max),
    drop: Math.max(a.drop, b.drop, a.max - b.min),
  };
}

/** Remove shallow outer edges, preserving the ramps and saddles inside a group. */
function trimEdges(
  profile: ProfilePoint[],
  first: Candidate,
  last: Candidate,
): Candidate {
  // Subtract a 3% baseline. A falling value means the interval averages below
  // 3%; its minimum marks the foot of the sustained climb, its maximum the top.
  // Require 20 m of deficit to avoid moving boundaries for small flattenings
  // and altitude noise. This is our boundary policy, not a published GPS algorithm.
  const excess = (i: number) =>
    profile[i].altitude - (MIN_GRADE * profile[i].distance) / 100;
  let start = first.start,
    end = last.end,
    foot = start,
    summit = end;
  // Search only the outer tentative sections. Searching the complete group
  // could discard a real first ramp because of a long flat inside the climb.
  for (let i = start + 1; i <= first.end; i++)
    if (excess(i) < excess(foot)) foot = i;
  if (excess(start) - excess(foot) >= MIN_EDGE_DEFICIT) start = foot;
  for (let i = Math.max(start, last.start); i < end; i++)
    if (excess(i) > excess(summit)) summit = i;
  if (excess(summit) - excess(end) >= MIN_EDGE_DEFICIT) end = summit;
  return { start, end };
}

/** Group the complete ascent first; partition at the strongest saddle only if it cannot qualify. */
function groupClimbs(
  candidates: Candidate[],
  profile: ProfilePoint[],
  distance: number[],
): DetectedClimb[] {
  if (candidates.length === 0) return [];
  const bodies = candidates.map((c) => summarize(profile, c.start, c.end));
  const gaps = candidates.slice(1).map((next, i) => {
    const end = profile[candidates[i].end],
      start = profile[next.start];
    const summary = summarize(profile, candidates[i].end, next.start);
    // Long flats and descents both separate efforts, measured in metres of
    // elevation needed to maintain the minimum average gradient across the gap.
    const deficit =
      (MIN_GRADE * (distance[start.index] - distance[end.index])) / 100 -
      (start.altitude - end.altitude);
    return { summary, separation: Math.max(summary.drop, deficit) };
  });
  const result: DetectedClimb[] = [];
  const pending: [number, number][] = [[0, candidates.length - 1]];
  while (pending.length) {
    const [first, last] = pending.pop()!;
    const start = candidates[first].start,
      end = candidates[last].end;
    const trimmed = trimEdges(profile, candidates[first], candidates[last]);
    const climb = measureClimb(profile, distance, trimmed.start, trimmed.end);
    let summary = bodies[first];
    let split = first,
      separation = -Infinity;
    for (let i = first; i < last; i++) {
      summary = combine(combine(summary, gaps[i].summary), bodies[i + 1]);
      if (gaps[i].separation > separation) {
        split = i;
        separation = gaps[i].separation;
      }
    }
    // The grouped interval must still run from its valley to its summit. Judge
    // internal dips against the complete climb's gain, not the smaller approach.
    if (
      climb &&
      (first === last ||
        (summary.min >= profile[start].altitude &&
          summary.max <= profile[end].altitude &&
          summary.drop <= Math.max(MIN_DROP, climb.gain * DROP_FRACTION)))
    ) {
      result.push(climb);
    } else if (first < last) {
      // Left first, preserving chronological, disjoint output without recursion.
      pending.push([split + 1, last], [first, split]);
    }
  }
  return result;
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
