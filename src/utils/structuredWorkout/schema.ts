import { z } from "zod";

import { flattenNodeIds, maxDepth } from "./edit";
import { resolvedSegmentCount, totalDuration } from "./flatten";
import type { StructuredWorkout, WorkoutNode, WorkoutRepeat } from "./types";
import {
  MAX_FTP_PCT,
  MAX_REPEAT_DEPTH,
  MAX_RESOLVED_SEGMENTS,
  MAX_WORKOUT_SECONDS,
  MIN_STEP_SECONDS,
  STRUCTURED_WORKOUT_SCHEMA_VERSION,
} from "./types";

/**
 * Validation for the authored tree, shared by the tRPC router and the builder's
 * pre-save check so the client can surface the same errors the server enforces.
 */

const pctSchema = z.number().min(0).max(MAX_FTP_PCT);

const powerTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pct"), pct: pctSchema }),
  z.object({ kind: z.literal("ramp"), from: pctSchema, to: pctSchema }),
  z.object({
    kind: z.literal("free"),
    guide: z.object({ low: pctSchema, high: pctSchema }).optional(),
  }),
]);

const cadenceTargetSchema = z.number().int().min(30).max(200);

/** Ids are opaque handles, not a format contract — only their uniqueness matters. */
const idSchema = z.string().min(1).max(64);

const stepSchema = z.object({
  type: z.literal("step"),
  id: idSchema,
  durationSeconds: z
    .number()
    .int()
    .min(MIN_STEP_SECONDS)
    .max(MAX_WORKOUT_SECONDS),
  power: powerTargetSchema,
  cadence: cadenceTargetSchema.optional(),
  intensity: z
    .enum(["warmup", "work", "recovery", "rest", "cooldown"])
    .optional(),
  note: z.string().max(120).optional(),
});

// Recursion is expressed with a getter, zod 4's way of deferring a self-
// reference: `children` is only resolved when something actually parses, by
// which point `nodeSchema` exists. A plain property would evaluate here, while
// `nodeSchema` is still in its temporal dead zone.
const repeatSchema: z.ZodType<WorkoutRepeat> = z.object({
  type: z.literal("repeat"),
  id: idSchema,
  reps: z.number().int().min(2).max(50),
  get children() {
    return z.array(nodeSchema).min(1).max(50);
  },
});

// A plain union rather than `discriminatedUnion`: the discriminator optimisation
// needs both members eagerly, which is exactly what the recursion cannot give.
const nodeSchema: z.ZodType<WorkoutNode> = z.union([stepSchema, repeatSchema]);

export const structuredWorkoutSchema: z.ZodType<StructuredWorkout> = z
  .object({
    version: z.literal(STRUCTURED_WORKOUT_SCHEMA_VERSION),
    sport: z.enum(["bike", "run"]),
    nodes: z.array(nodeSchema).min(1).max(200),
  })
  // Depth, expansion and total duration are properties of the whole tree, so
  // they cannot be expressed structurally.
  .superRefine((workout, ctx) => {
    if (maxDepth(workout.nodes) > MAX_REPEAT_DEPTH) {
      ctx.addIssue({
        code: "custom",
        path: ["nodes"],
        message: `Repeats can be nested at most ${MAX_REPEAT_DEPTH} levels deep`,
      });
    }

    if (resolvedSegmentCount(workout) > MAX_RESOLVED_SEGMENTS) {
      ctx.addIssue({
        code: "custom",
        path: ["nodes"],
        message: `A workout expands to at most ${MAX_RESOLVED_SEGMENTS} steps`,
      });
    }

    if (totalDuration(workout) > MAX_WORKOUT_SECONDS) {
      ctx.addIssue({
        code: "custom",
        path: ["nodes"],
        message: `A workout can last at most ${MAX_WORKOUT_SECONDS / 3600} hours`,
      });
    }

    const ids = flattenNodeIds(workout.nodes);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "Duplicate node ids",
      });
    }
  });
