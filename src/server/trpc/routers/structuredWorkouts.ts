import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { TRPCError } from "@trpc/server";

import {
  migrateStructuredWorkout,
  structuredWorkoutSchema,
  totalDuration,
} from "../../../utils/structuredWorkout";
import { structuredWorkouts } from "../../db/schema";
import type { ListStructuredWorkout } from "../../db/types";
import { summarizeWorkout } from "../../lib/workoutSummary";
import { athleteProcedure, router } from "../index";

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
  list: athleteProcedure.query(
    async ({ ctx, input }): Promise<ListStructuredWorkout[]> => {
      const rows = await ctx.db
        .select()
        .from(structuredWorkouts)
        .where(eq(structuredWorkouts.athlete, input.athleteId))
        .orderBy(desc(structuredWorkouts.updatedAt));

      return rows.map(summarizeWorkout);
    },
  ),

  get: athleteProcedure
    .input(z.object({ id: z.number() }))
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

  create: athleteProcedure
    .input(z.object(workoutFields))
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

  update: athleteProcedure
    .input(z.object({ id: z.number(), ...workoutFields }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
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
        )
        .returning();
      // Deleted in the meantime: a save that wrote nothing must not succeed.
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workout not found",
        });
      }
      // Shaped like `get`, so the client can cache it as the workout's read.
      return { ...row, structure: migrateStructuredWorkout(row.structure) };
    }),

  /**
   * Copies a workout server-side. The node ids inside `structure` are reused as
   * they are: they are only unique *within* a tree, and nothing joins across
   * workouts.
   */
  duplicate: athleteProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().trim().min(1).max(200),
      }),
    )
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

  delete: athleteProcedure
    .input(z.object({ id: z.number() }))
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
