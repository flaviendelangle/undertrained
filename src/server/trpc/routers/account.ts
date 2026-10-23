import { eq } from "drizzle-orm";
import { z } from "zod";

import { LOCALES } from "~/i18n/locales";

import { athletes } from "../../db/schema";
import { eraseAthleteData } from "../../lib/athleteErasure";
import { protectedProcedure, router, validateAthleteOwnership } from "../index";

export const accountRouter = router({
  deleteAllData: protectedProcedure
    .input(z.object({ athleteId: z.number() }))
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      await eraseAthleteData(ctx.db, input.athleteId);
    }),

  // Account-level UI locale. Kept separate from riderSettings.save so that
  // changing language never triggers a training-score recompute.
  getLanguage: protectedProcedure
    .input(z.object({ athleteId: z.number() }))
    .use(validateAthleteOwnership)
    .query(async ({ ctx, input }) => {
      const athlete = await ctx.db.query.athletes.findFirst({
        where: eq(athletes.id, input.athleteId),
        columns: { language: true },
      });
      return athlete?.language ?? null;
    }),

  setLanguage: protectedProcedure
    .input(z.object({ athleteId: z.number(), language: z.enum(LOCALES) }))
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(athletes)
        .set({ language: input.language })
        .where(eq(athletes.id, input.athleteId));
    }),
});
