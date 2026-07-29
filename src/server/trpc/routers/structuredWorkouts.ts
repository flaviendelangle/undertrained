import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { TRPCError } from "@trpc/server";

import {
  describeWorkoutShort,
  flattenWorkout,
  migrateStructuredWorkout,
  structuredWorkoutSchema,
  totalDuration,
  workoutProfile,
} from "../../../utils/structuredWorkout";
import { structuredWorkouts } from "../../db/schema";
import type { ListStructuredWorkout } from "../../db/types";
import { protectedProcedure, router, validateAthleteOwnership } from "../index";

/** Shared validators for create/update, so the two can never drift apart. */
const workoutFields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  sport: z.enum(["bike", "run"]),
  structure: structuredWorkoutSchema,
  /**
   * Computed client-side at the athlete's current FTP. A display cache, not a
   * fact — `ftpAtSave` records what it was computed against, and the UI
   * recomputes from the tree whenever it has an FTP to hand.
   */
  estimatedTss: z.number().nonnegative().max(2000).nullable().optional(),
  ftpAtSave: z.number().int().positive().max(600).nullable().optional(),
};

export const structuredWorkoutsRouter = router({
  /**
   * Grid projection: everything except the `structure` tree, plus a coarse
   * profile and one-line summary derived from it server-side. A page of full
   * trees would be an order of magnitude larger for no benefit.
   */
  list: protectedProcedure
    .input(z.object({ athleteId: z.number() }))
    .use(validateAthleteOwnership)
    .query(async ({ ctx, input }): Promise<ListStructuredWorkout[]> => {
      const rows = await ctx.db
        .select()
        .from(structuredWorkouts)
        .where(eq(structuredWorkouts.athlete, input.athleteId))
        .orderBy(desc(structuredWorkouts.updatedAt));

      return rows.map(({ structure, description: _description, ...rest }) => {
        // A single corrupted row must not take the whole library down with it.
        let profile: [number, number | null][] = [];
        let summary = "";
        try {
          const workout = migrateStructuredWorkout(structure);
          profile = workoutProfile(flattenWorkout(workout));
          summary = describeWorkoutShort(workout);
        } catch (error) {
          console.error(
            `[structuredWorkouts] Skipping unreadable structure for workout ${rest.id}:`,
            error,
          );
        }
        return { ...rest, profile, summary };
      });
    }),

  get: protectedProcedure
    .input(z.object({ athleteId: z.number(), id: z.number() }))
    .use(validateAthleteOwnership)
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(structuredWorkouts)
        .where(
          and(
            eq(structuredWorkouts.id, input.id),
            eq(structuredWorkouts.athlete, input.athleteId),
          ),
        );
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workout not found",
        });
      }
      return { ...row, structure: migrateStructuredWorkout(row.structure) };
    }),

  create: protectedProcedure
    .input(z.object({ athleteId: z.number(), ...workoutFields }))
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      const now = Date.now();
      const [row] = await ctx.db
        .insert(structuredWorkouts)
        .values({
          athlete: input.athleteId,
          name: input.name,
          description: input.description ?? null,
          sport: input.sport,
          structure: input.structure,
          // Never trusted from the client: it drives the Journal and the list.
          durationSeconds: totalDuration(input.structure),
          estimatedTss: input.estimatedTss ?? null,
          ftpAtSave: input.ftpAtSave ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return row;
    }),

  update: protectedProcedure
    .input(
      z.object({ athleteId: z.number(), id: z.number(), ...workoutFields }),
    )
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(structuredWorkouts)
        .set({
          name: input.name,
          description: input.description ?? null,
          sport: input.sport,
          structure: input.structure,
          durationSeconds: totalDuration(input.structure),
          estimatedTss: input.estimatedTss ?? null,
          ftpAtSave: input.ftpAtSave ?? null,
          updatedAt: Date.now(),
        })
        .where(
          and(
            eq(structuredWorkouts.id, input.id),
            eq(structuredWorkouts.athlete, input.athleteId),
          ),
        );
    }),

  /**
   * Copies a workout server-side. The node ids inside `structure` are reused as
   * they are: they are only unique *within* a tree, and nothing joins across
   * workouts.
   */
  duplicate: protectedProcedure
    .input(
      z.object({
        athleteId: z.number(),
        id: z.number(),
        name: z.string().trim().min(1).max(200),
      }),
    )
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      const [source] = await ctx.db
        .select()
        .from(structuredWorkouts)
        .where(
          and(
            eq(structuredWorkouts.id, input.id),
            eq(structuredWorkouts.athlete, input.athleteId),
          ),
        );
      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workout not found",
        });
      }

      const now = Date.now();
      const [row] = await ctx.db
        .insert(structuredWorkouts)
        .values({
          athlete: input.athleteId,
          name: input.name,
          description: source.description,
          sport: source.sport,
          structure: source.structure,
          durationSeconds: source.durationSeconds,
          estimatedTss: source.estimatedTss,
          ftpAtSave: source.ftpAtSave,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return row;
    }),

  delete: protectedProcedure
    .input(z.object({ athleteId: z.number(), id: z.number() }))
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(structuredWorkouts)
        .where(
          and(
            eq(structuredWorkouts.id, input.id),
            eq(structuredWorkouts.athlete, input.athleteId),
          ),
        );
    }),
});
