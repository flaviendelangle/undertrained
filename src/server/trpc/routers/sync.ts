import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { activities, syncJobs } from "../../db/schema";
import { runSyncInBackground } from "../../lib/sync";
import {
  protectedProcedure,
  rateLimited,
  router,
  validateAthleteOwnership,
} from "../index";

const syncModeSchema = z.enum([
  "load_new",
  "load_missing",
  "reload_all",
  "recompute_scores",
]);

export const syncRouter = router({
  getJob: protectedProcedure
    .input(z.object({ athleteId: z.number() }))
    .use(validateAthleteOwnership)
    .query(async ({ ctx, input }) => {
      return (
        (await ctx.db.query.syncJobs.findFirst({
          where: eq(syncJobs.athlete, input.athleteId),
        })) ?? null
      );
    }),

  start: protectedProcedure
    .input(
      z.object({
        athleteId: z.number(),
        mode: syncModeSchema,
      }),
    )
    .use(validateAthleteOwnership)
    .use(rateLimited)
    .mutation(async ({ ctx, input }) => {
      // Wrap in a transaction so SELECT ... FOR UPDATE holds the lock
      // until the INSERT/UPDATE completes, preventing duplicate sync jobs.
      const { syncJobId, afterEpoch } = await ctx.db.transaction(async (tx) => {
        const [existing] = await tx.execute<typeof syncJobs.$inferSelect>(
          sql`SELECT * FROM sync_jobs WHERE athlete = ${input.athleteId} LIMIT 1 FOR UPDATE`,
        );

        if (
          existing &&
          (existing.status === "fetching_activities" ||
            existing.status === "fetching_streams" ||
            existing.status === "computing_scores")
        ) {
          return { syncJobId: existing.id, afterEpoch: undefined };
        }

        // For "load_new", compute `after` from latest activity
        let afterEpoch: number | undefined;
        if (input.mode === "load_new") {
          const latestActivity = await tx
            .select({ startDate: activities.startDate })
            .from(activities)
            .where(eq(activities.athlete, input.athleteId))
            .orderBy(desc(activities.startDate))
            .limit(1)
            .then((rows) => rows[0] ?? null);

          if (latestActivity) {
            // Subtract 60s for safety margin (avoid missing activities at the boundary)
            afterEpoch =
              Math.floor(new Date(latestActivity.startDate).getTime() / 1000) -
              60;
          }
        }

        // For "reload_all", delete all activities (streams cascade via FK)
        if (input.mode === "reload_all") {
          await tx
            .delete(activities)
            .where(eq(activities.athlete, input.athleteId));
        }

        const initialStatus: "fetching_activities" | "computing_scores" =
          input.mode === "recompute_scores"
            ? "computing_scores"
            : "fetching_activities";

        const now = Date.now();
        let syncJobId: number;

        if (existing) {
          await tx
            .update(syncJobs)
            .set({
              status: initialStatus,
              mode: input.mode,
              activitiesFetched: 0,
              activitiesPagesComplete: false,
              streamsTotal: 0,
              streamsFetched: 0,
              lastError: null,
              startedAt: now,
            })
            .where(eq(syncJobs.id, existing.id));
          syncJobId = existing.id;
        } else {
          const [row] = await tx
            .insert(syncJobs)
            .values({
              athlete: input.athleteId,
              status: initialStatus,
              mode: input.mode,
              activitiesFetched: 0,
              activitiesPagesComplete: false,
              streamsTotal: 0,
              streamsFetched: 0,
              startedAt: now,
            })
            .returning({ id: syncJobs.id });
          syncJobId = row.id;
        }

        return { syncJobId, afterEpoch };
      });

      // Fire-and-forget background sync (outside the transaction)
      runSyncInBackground(
        ctx.db,
        input.athleteId,
        syncJobId,
        input.mode,
        afterEpoch,
      ).catch((err) =>
        console.error("[runSyncInBackground] Unhandled error:", err),
      );

      return syncJobId;
    }),
});
