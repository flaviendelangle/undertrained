import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  activities,
  athletes,
  syncJobModeEnum,
  syncJobs,
} from "../../db/schema";
import { activityIngestion } from "../../lib/sync";
import { athleteProcedure, rateLimited, router } from "../index";

const syncModeSchema = z.enum(syncJobModeEnum.enumValues);

export const syncRouter = router({
  getStatus: athleteProcedure.query(async ({ ctx, input }) => {
    const [job, athlete] = await Promise.all([
      ctx.db.query.syncJobs.findFirst({
        where: eq(syncJobs.athlete, input.athleteId),
      }),
      ctx.db.query.athletes.findFirst({
        where: eq(athletes.id, input.athleteId),
        columns: { lastWebhookSyncAt: true },
      }),
    ]);
    return {
      job: job ?? null,
      lastWebhookSyncAt: athlete?.lastWebhookSyncAt ?? null,
    };
  }),

  start: athleteProcedure
    .input(
      z.object({
        mode: syncModeSchema,
      }),
    )
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

        // For "reload_all", delete all activities (streams cascade via FK).
        // Plans marked done stay `completed` but lose `linkedActivityId` to its
        // `set null` cascade, and the re-import can't restore it: nothing keeps
        // the Strava id it pointed at. The Journal goes by `status` and the
        // iCal feed ignores the link, so neither changes. The activity can be
        // linked to a second plan, though, because the link was the guard
        // against that.
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
      activityIngestion(ctx.db)
        .runSync(input.athleteId, syncJobId, input.mode, afterEpoch)
        .catch((err) => console.error("[runSync] Unhandled error:", err));

      return syncJobId;
    }),
});
