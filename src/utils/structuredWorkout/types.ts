/**
 * Hand-authored interval workouts — the *prospective* model. This is what the
 * builder edits, what the ERG player executes, and what a `.zwo` / FIT workout
 * / `.erg` exporter will lower from.
 *
 * Not to be confused with its retrospective cousin in `~/utils/workoutStructure`,
 * which *detects* the structure of a ride that already happened. That model is
 * lossy by design (median-rounded, lap-indexed, scored by confidence); this one
 * is exact and authorable. Keep them separate.
 *
 * Design contract: everything here must lower cleanly to `.zwo`, FIT
 * `workout_step` and `.erg`/`.mrc` without needing information the tree does
 * not carry.
 */

/** Bump on any persisted-shape change; `migrate.ts` switches on it. */
export const STRUCTURED_WORKOUT_SCHEMA_VERSION = 1;

export type WorkoutSport = "bike" | "run";

/**
 * The role a step plays. Purely semantic — it picks the `.zwo` tag
 * (`<Warmup>` vs `<SteadyState>`), the FIT `workout_step.intensity` enum, the
 * default label and the row accent. It never changes the power maths, which is
 * why a warm-up can be steady and a cool-down can ramp.
 */
export type StepIntensity =
  | "warmup"
  | "work"
  | "recovery"
  | "rest"
  | "cooldown";

/**
 * A power target, always expressed as a **fraction of FTP** (0.88 = 88 %).
 *
 * Authored as a single number, never a band: a target the rider is asked to hit
 * is one number, and the tolerance around it is a property of *riding* it, not
 * of the plan. `complianceTolerance` owns that band, so the HUD and the
 * post-ride score can never disagree about what counts as on target.
 * Watts are derived at render time from the athlete's FTP-of-the-day and never
 * stored, so a saved workout rescales itself when FTP moves.
 *
 * The fraction (rather than an integer percent) matches `POWER_ZONES[].maxPct`
 * and `.zwo`'s `Power="0.88"`, so both need zero conversion.
 *
 * NOTE: `kind: "ramp"` is unrelated to `POWER_ZONES[].ramp`, which is a colour
 * index into the shared zone ramp. Never destructure both in one scope.
 */
export type PowerTarget =
  /** Single target. ERG holds this number. → `.zwo` `<SteadyState Power>`. */
  | { kind: "pct"; pct: number }
  /** Linear sweep across the step. → `.zwo` `<Warmup>`/`<Cooldown>`/`<Ramp>`. */
  | { kind: "ramp"; from: number; to: number }
  /** No target at all. → `.zwo` `<FreeRide>`; FIT `target_type: "open"`. */
  | { kind: "free" };

/**
 * Optional cadence target, in rpm.
 *
 * A single number for the same reason power is: what the rider is asked to hold
 * is one value, and how far off it still counts as on target belongs to riding
 * it — `cadenceTolerance` owns that band. Both export formats want a range, so
 * an exporter widens this by the same tolerance on the way out.
 */
export type CadenceTarget = number;

export interface WorkoutStep {
  type: "step";
  /**
   * Stable uuid. Survives DB round-trips and doubles as the React key, the
   * selection id, and the join key between an editor row and every one of its
   * rep instances in the preview chart.
   */
  id: string;
  durationSeconds: number;
  power: PowerTarget;
  cadence?: CadenceTarget;
  intensity?: StepIntensity;
  /** Short free text. → `.zwo` `<textevent>`, FIT `wkt_step_name`. */
  note?: string;
}

export interface WorkoutRepeat {
  type: "repeat";
  id: string;
  /** At least 2 — dropping to 1 auto-ungroups in the editor. */
  reps: number;
  /** At least one child. May hold further repeats, up to {@link MAX_REPEAT_DEPTH}. */
  children: WorkoutNode[];
}

export type WorkoutNode = WorkoutStep | WorkoutRepeat;

export interface StructuredWorkout {
  version: number;
  sport: WorkoutSport;
  nodes: WorkoutNode[];
}

/** Devices and file formats degrade past this; the UI disables "Group" at the limit. */
export const MAX_REPEAT_DEPTH = 3;
/** Guards combinatorial blow-up (50×50×50) before it reaches the chart or a FIT writer. */
export const MAX_RESOLVED_SEGMENTS = 2000;
export const MAX_WORKOUT_SECONDS = 8 * 3600;
/** 300 % FTP. The UI clamps tighter still, against MAX_TARGET_POWER_WATTS / ftp. */
export const MAX_FTP_PCT = 3;
/** Shortest authorable step. Also the rounding grid the duration steppers snap to. */
export const MIN_STEP_SECONDS = 5;

export function isStep(node: WorkoutNode): node is WorkoutStep {
  return node.type === "step";
}

export function isRepeat(node: WorkoutNode): node is WorkoutRepeat {
  return node.type === "repeat";
}

/**
 * Rounds a %FTP value onto a 0.1 % grid. Stepping `pct` by 0.01 accumulates
 * float error fast (0.65 + 0.01 → 0.66000000000000003), which then leaks into
 * the JSON payload and every derived watt figure.
 */
export function roundPct(pct: number): number {
  return Math.round(pct * 1000) / 1000;
}

/**
 * The representative intensity of a target, used for zone colouring and for
 * the one-line summaries. Ranges collapse to their midpoint; `free` has none.
 */
export function targetMidPct(target: PowerTarget): number | null {
  switch (target.kind) {
    case "pct":
      return target.pct;
    case "ramp":
      return (target.from + target.to) / 2;
    case "free":
      return null;
  }
}
