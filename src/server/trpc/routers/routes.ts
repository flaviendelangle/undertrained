import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { ROUTE_PROFILE_VALUES } from "../../../utils/routeProfiles";
import { routes } from "../../db/schema";
import { getDirections } from "../../lib/openRouteService";
import {
  protectedProcedure,
  routePreviewRateLimited,
  router,
  validateAthleteOwnership,
} from "../index";

// [lat, lng] anchor tuple. ORS caps a single directions request at 50 waypoints.
const waypointSchema = z.tuple([
  z.number().min(-90).max(90),
  z.number().min(-180).max(180),
]);

const profileSchema = z.enum(ROUTE_PROFILE_VALUES);
const sportSchema = z.enum(["cycling", "running"]);

export const routesRouter = router({
  /**
   * Road-snaps the given waypoints via OpenRouteService. Pure proxy used live
   * while drawing — nothing is persisted. Rate-limited to protect the ORS quota.
   */
  preview: protectedProcedure
    .input(
      z.object({
        athleteId: z.number(),
        profile: profileSchema,
        waypoints: z.array(waypointSchema).min(2).max(50),
      }),
    )
    .use(validateAthleteOwnership)
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

  list: protectedProcedure
    .input(z.object({ athleteId: z.number() }))
    .use(validateAthleteOwnership)
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(routes)
        .where(eq(routes.athlete, input.athleteId))
        .orderBy(desc(routes.createdAt));
    }),

  get: protectedProcedure
    .input(z.object({ athleteId: z.number(), id: z.number() }))
    .use(validateAthleteOwnership)
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

  create: protectedProcedure
    .input(
      z.object({
        athleteId: z.number(),
        name: z.string().min(1).max(200),
        sport: sportSchema,
        profile: profileSchema,
        waypoints: z.array(waypointSchema).min(2).max(50),
        mapPolyline: z.string().min(1),
        distance: z.number().nonnegative(),
        elevationGain: z.number().nonnegative().nullable().optional(),
      }),
    )
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      const now = Date.now();
      const [row] = await ctx.db
        .insert(routes)
        .values({
          athlete: input.athleteId,
          name: input.name,
          sport: input.sport,
          profile: input.profile,
          waypoints: input.waypoints,
          mapPolyline: input.mapPolyline,
          distance: input.distance,
          elevationGain: input.elevationGain ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return row;
    }),

  update: protectedProcedure
    .input(
      z.object({
        athleteId: z.number(),
        id: z.number(),
        name: z.string().min(1).max(200),
        sport: sportSchema,
        profile: profileSchema,
        waypoints: z.array(waypointSchema).min(2).max(50),
        mapPolyline: z.string().min(1),
        distance: z.number().nonnegative(),
        elevationGain: z.number().nonnegative().nullable().optional(),
      }),
    )
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(routes)
        .set({
          name: input.name,
          sport: input.sport,
          profile: input.profile,
          waypoints: input.waypoints,
          mapPolyline: input.mapPolyline,
          distance: input.distance,
          elevationGain: input.elevationGain ?? null,
          updatedAt: Date.now(),
        })
        .where(
          and(eq(routes.id, input.id), eq(routes.athlete, input.athleteId)),
        );
    }),

  delete: protectedProcedure
    .input(z.object({ athleteId: z.number(), id: z.number() }))
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(routes)
        .where(
          and(eq(routes.id, input.id), eq(routes.athlete, input.athleteId)),
        );
    }),
});
