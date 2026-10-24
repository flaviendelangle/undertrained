import { eq } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import { riderSettings } from "../../db/schema";
import { activityIngestion } from "../../lib/sync";
import { athleteProcedure, router } from "../index";

const changePointSchema = z.object({
  id: z.string(),
  date: z.string(),
  ftp: z.number().positive().max(2000).optional(),
  weightKg: z.number().positive().max(500).optional(),
  restingHr: z.number().int().positive().max(200).optional(),
  maxHr: z.number().int().positive().max(250).optional(),
  lthr: z.number().int().positive().max(250).optional(),
  runThresholdPace: z.number().positive().max(20).optional(), // m/s
  swimThresholdPace: z.number().positive().max(10).optional(), // m/s
});

const initialValuesSchema = z.object({
  ftp: z.number().positive().max(2000).nullable(),
  weightKg: z.number().positive().max(500).nullable(),
  restingHr: z.number().int().positive().max(200).nullable(),
  maxHr: z.number().int().positive().max(250).nullable(),
  lthr: z.number().int().positive().max(250).nullable(),
  runThresholdPace: z.number().positive().max(20).nullable(), // m/s
  swimThresholdPace: z.number().positive().max(10).nullable(), // m/s
});

export const riderSettingsRouter = router({
  get: athleteProcedure.query(async ({ ctx, input }) => {
    return (
      (await ctx.db.query.riderSettings.findFirst({
        where: eq(riderSettings.athlete, input.athleteId),
      })) ?? null
    );
  }),

  save: athleteProcedure
    .input(
      z.object({
        cdA: z.number().positive().max(2),
        crr: z.number().positive().max(1),
        bikeWeightKg: z.number().positive().max(50),
        cyclingLoadAlgorithm: z.enum(["tss", "hrss"]).default("tss"),
        runningLoadAlgorithm: z.enum(["rtss", "hrss"]).default("rtss"),
        swimmingLoadAlgorithm: z.enum(["stss", "hrss"]).default("stss"),
        initialValues: initialValuesSchema,
        changes: z.array(changePointSchema),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { athleteId, ...data } = input;

      // Ensure changes are sorted by date
      data.changes = [...data.changes].sort((a, b) =>
        a.date.localeCompare(b.date),
      );

      const existing = await ctx.db.query.riderSettings.findFirst({
        where: eq(riderSettings.athlete, athleteId),
      });

      if (existing) {
        await ctx.db
          .update(riderSettings)
          .set(data)
          .where(eq(riderSettings.id, existing.id));
      } else {
        await ctx.db.insert(riderSettings).values({
          athlete: athleteId,
          ...data,
        });
      }

      // Scores only read the timeline, so equipment and load-algorithm edits
      // (saved on every keystroke) leave them as they are.
      const timelineChanged =
        !existing ||
        !isDeepStrictEqual(existing.initialValues, data.initialValues) ||
        !isDeepStrictEqual(existing.changes, data.changes);
      if (timelineChanged) {
        // Fire-and-forget recomputation
        activityIngestion(ctx.db)
          .rescoreAll(athleteId)
          .catch((err) => console.error("[rescoreAll] Error:", err));
      }
    }),
});
