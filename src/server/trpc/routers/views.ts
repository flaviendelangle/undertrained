import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { TRPCError } from "@trpc/server";

import {
  activityDisplaySchema,
  activityRulesSchema,
} from "~/utils/activityFilters";

import type { Database } from "../../db";
import { activities, activityViews, viewFolders } from "../../db/schema";
import {
  activityFilterInput,
  activityRuleCondition,
  calendarDate,
  selectActivities,
} from "../../lib/activitySelection";
import { athleteProcedure, router } from "../index";

const name = z.string().trim().min(1).max(100);
const viewFields = z.object({
  name,
  folderId: z.number().int().positive().nullable(),
  rules: activityRulesSchema,
  display: activityDisplaySchema,
});

async function requireFolder(
  db: Database,
  athleteId: number,
  folderId: number | null,
) {
  if (folderId === null) return;
  const [folder] = await db
    .select({ id: viewFolders.id })
    .from(viewFolders)
    .where(
      and(eq(viewFolders.id, folderId), eq(viewFolders.athlete, athleteId)),
    );
  if (!folder)
    throw new TRPCError({ code: "NOT_FOUND", message: "Folder not found" });
}

export const viewsRouter = router({
  list: athleteProcedure.query(({ ctx, input }) =>
    ctx.db
      .select()
      .from(activityViews)
      .where(eq(activityViews.athlete, input.athleteId))
      .orderBy(asc(activityViews.name)),
  ),
  create: athleteProcedure
    .input(viewFields)
    .mutation(async ({ ctx, input }) => {
      await requireFolder(ctx.db, input.athleteId, input.folderId);
      const [view] = await ctx.db
        .insert(activityViews)
        .values({
          athlete: input.athleteId,
          name: input.name,
          folderId: input.folderId,
          rules: input.rules,
          display: input.display,
        })
        .returning();
      return view;
    }),
  update: athleteProcedure
    .input(viewFields.extend({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await requireFolder(ctx.db, input.athleteId, input.folderId);
      const [view] = await ctx.db
        .update(activityViews)
        .set({
          name: input.name,
          folderId: input.folderId,
          rules: input.rules,
          display: input.display,
        })
        .where(
          and(
            eq(activityViews.id, input.id),
            eq(activityViews.athlete, input.athleteId),
          ),
        )
        .returning();
      if (!view)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Saved view not found",
        });
      return view;
    }),
  delete: athleteProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .delete(activityViews)
        .where(
          and(
            eq(activityViews.id, input.id),
            eq(activityViews.athlete, input.athleteId),
          ),
        )
        .returning({ id: activityViews.id });
      if (!rows.length)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Saved view not found",
        });
    }),
  listFolders: athleteProcedure.query(({ ctx, input }) =>
    ctx.db
      .select()
      .from(viewFolders)
      .where(eq(viewFolders.athlete, input.athleteId))
      .orderBy(asc(viewFolders.name)),
  ),
  createFolder: athleteProcedure
    .input(z.object({ name }))
    .mutation(async ({ ctx, input }) => {
      const [folder] = await ctx.db
        .insert(viewFolders)
        .values({ name: input.name, athlete: input.athleteId })
        .returning();
      return folder;
    }),
  renameFolder: athleteProcedure
    .input(z.object({ id: z.number().int().positive(), name }))
    .mutation(async ({ ctx, input }) => {
      const [folder] = await ctx.db
        .update(viewFolders)
        .set({ name: input.name })
        .where(
          and(
            eq(viewFolders.id, input.id),
            eq(viewFolders.athlete, input.athleteId),
          ),
        )
        .returning();
      if (!folder)
        throw new TRPCError({ code: "NOT_FOUND", message: "Folder not found" });
      return folder;
    }),
  deleteFolder: athleteProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db
        .delete(viewFolders)
        .where(
          and(
            eq(viewFolders.id, input.id),
            eq(viewFolders.athlete, input.athleteId),
          ),
        )
        .returning({ id: viewFolders.id });
      if (!deleted.length)
        throw new TRPCError({ code: "NOT_FOUND", message: "Folder not found" });
    }),
  summary: athleteProcedure
    .input(activityFilterInput)
    .query(async ({ ctx, input }) => {
      const selected = selectActivities(input);
      const [row] = await ctx.db
        .select({
          count: sql<number>`count(*)::int`,
        })
        .from(activities)
        .where(selected);
      return row;
    }),
  counts: athleteProcedure
    .input(z.object({ today: calendarDate }))
    .query(async ({ ctx, input }) => {
      const views = await ctx.db
        .select()
        .from(activityViews)
        .where(eq(activityViews.athlete, input.athleteId));
      if (!views.length) return {};
      const expressions = views.map(
        (view) =>
          sql`count(*) filter (where ${activityRuleCondition(view.rules, activities, input.today)})::int as ${sql.identifier(String(view.id))}`,
      );
      const rows = await ctx.db.execute<Record<string, number>>(
        sql`select ${sql.join(expressions, sql`, `)} from ${activities} where ${activities.athlete} = ${input.athleteId}`,
      );
      return rows[0] ?? {};
    }),
});
