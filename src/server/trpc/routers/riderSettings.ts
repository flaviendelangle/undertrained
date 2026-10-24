import { eq } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";

import { riderSettingsTimelineSchema } from "../../../utils/riderSettingsSchema";
import { riderSettings } from "../../db/schema";
import { activityIngestion } from "../../lib/sync";
import { athleteProcedure, router } from "../index";

export const riderSettingsRouter = router({
  get: athleteProcedure.query(async ({ ctx, input }) => {
    return (
      (await ctx.db.query.riderSettings.findFirst({
        where: eq(riderSettings.athlete, input.athleteId),
      })) ?? null
    );
  }),

  save: athleteProcedure
    .input(riderSettingsTimelineSchema)
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
