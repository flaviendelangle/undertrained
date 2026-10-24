import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { TRPCError } from "@trpc/server";

import {
  ROUTE_PROFILE_VALUES,
  ROUTE_SPORTS,
} from "../../../utils/routeProfiles";
import { routes } from "../../db/schema";
import { getDirections } from "../../lib/openRouteService";
import { athleteProcedure, routePreviewRateLimited, router } from "../index";

// [lat, lng] anchor tuple. ORS caps a single directions request at 50 waypoints.
const waypointSchema = z.tuple([
  z.number().min(-90).max(90),
  z.number().min(-180).max(180),
]);

const profileSchema = z.enum(ROUTE_PROFILE_VALUES);

/** Shared validators for create/update, so the two can never drift apart. */
const routeFields = {
  name: z.string().min(1).max(200),
  sport: z.enum(ROUTE_SPORTS),
  profile: profileSchema,
  waypoints: z.array(waypointSchema).min(2).max(50),
  mapPolyline: z.string().min(1),
  distance: z.number().nonnegative(),
  elevationGain: z.number().nonnegative().nullable().optional(),
};

export const routesRouter = router({
  /**
   * Road-snaps the given waypoints via OpenRouteService. Pure proxy used live
   * while drawing — nothing is persisted. Rate-limited to protect the ORS quota.
   */
  preview: athleteProcedure
    .input(
      z.object({
        profile: profileSchema,
        waypoints: z.array(waypointSchema).min(2).max(50),
      }),
    )
    .use(routePreviewRateLimited)
    .mutation(async ({ input }) => {
      const result = await getDirections(input.profile, input.waypoints);
      return {
        encodedPolyline: result.encodedPolyline,
        points: result.points,
        elevation: result.elevation,
        wayPoints: result.wayPoints,
        distance: result.distance,
        ascent: result.ascent,
        descent: result.descent,
      };
    }),

  list: athleteProcedure.query(async ({ ctx, input }) => {
    return ctx.db
      .select()
      .from(routes)
      .where(eq(routes.athlete, input.athleteId))
      .orderBy(desc(routes.createdAt));
  }),

  get: athleteProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const [route] = await ctx.db
        .select()
        .from(routes)
        .where(
          and(eq(routes.id, input.id), eq(routes.athlete, input.athleteId)),
        );
      if (!route) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Route not found" });
      }
      return route;
    }),

  create: athleteProcedure
    .input(z.object(routeFields))
    .mutation(async ({ ctx, input }) => {
      const { athleteId, ...data } = input;
      const now = Date.now();
      const [row] = await ctx.db
        .insert(routes)
        .values({
          athlete: athleteId,
          ...data,
          elevationGain: data.elevationGain ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return row;
    }),

  update: athleteProcedure
    .input(z.object({ id: z.number(), ...routeFields }))
    .mutation(async ({ ctx, input }) => {
      const { athleteId, id, ...data } = input;
      await ctx.db
        .update(routes)
        .set({
          ...data,
          elevationGain: data.elevationGain ?? null,
          updatedAt: Date.now(),
        })
        .where(and(eq(routes.id, id), eq(routes.athlete, athleteId)));
    }),

  delete: athleteProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(routes)
        .where(
          and(eq(routes.id, input.id), eq(routes.athlete, input.athleteId)),
        );
    }),
});
