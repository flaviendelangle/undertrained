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

export interface SavedViewStats {
  count: number;
  /** Metres. */
  distance: number;
  /** Seconds. */
  movingTime: number;
  /** Metres climbed. */
  elevation: number;
  /** Local calendar days ("yyyy-MM-dd") of the first and last activity. */
  firstDay: string | null;
  lastDay: string | null;
  /** Activity types it selects, the most frequent first. */
  sports: string[];
}
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
  /** What each saved view selects today, keyed by view id. */
  stats: athleteProcedure
    .input(z.object({ today: calendarDate }))
    .query(async ({ ctx, input }) => {
      const views = await ctx.db
        .select({ id: activityViews.id, rules: activityViews.rules })
        .from(activityViews)
        .where(eq(activityViews.athlete, input.athleteId));
      const stats: Record<number, SavedViewStats> = {};
      if (!views.length) return stats;
      // One row per view and sport, so a single round trip also yields the
      // sport mix. Sums are float8 so they reach JS as numbers, not strings.
      const parts = views.map(
        (
          view,
        ) => sql`(select ${view.id}::int as view, ${activities.type} as sport,
          count(*)::int as count,
          sum(${activities.distance})::float8 as distance,
          sum(${activities.movingTime})::float8 as moving_time,
          sum(${activities.totalElevationGain})::float8 as elevation,
          min(${activities.startDateLocal}) as first,
          max(${activities.startDateLocal}) as last
        from ${activities}
        where ${activities.athlete} = ${input.athleteId}
          and ${activityRuleCondition(view.rules, activities, input.today)}
        group by ${activities.type})`,
      );
      const rows = await ctx.db.execute<{
        view: number;
        sport: string;
        count: number;
        distance: number;
        moving_time: number;
        elevation: number;
        first: string;
        last: string;
      }>(sql.join(parts, sql` union all `));
      for (const view of views)
        stats[view.id] = {
          count: 0,
          distance: 0,
          movingTime: 0,
          elevation: 0,
          firstDay: null,
          lastDay: null,
          sports: [],
        };
      const sportCounts = new Map<number, Map<string, number>>();
      for (const row of rows) {
        const view = stats[row.view];
        view.count += row.count;
        view.distance += row.distance;
        view.movingTime += row.moving_time;
        view.elevation += row.elevation;
        const first = row.first.slice(0, 10);
        const last = row.last.slice(0, 10);
        if (!view.firstDay || first < view.firstDay) view.firstDay = first;
        if (!view.lastDay || last > view.lastDay) view.lastDay = last;
        const counts = sportCounts.get(row.view) ?? new Map<string, number>();
        counts.set(row.sport, row.count);
        sportCounts.set(row.view, counts);
      }
      for (const [id, counts] of sportCounts)
        stats[id].sports = [...counts]
          .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
          .map(([sport]) => sport);
      return stats;
    }),
});
