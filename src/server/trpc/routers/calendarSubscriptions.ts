import { and, asc, eq, max } from "drizzle-orm";
import { z } from "zod";

import { TRPCError } from "@trpc/server";

import { calendarSubscriptions } from "../../db/schema";
import { env } from "../../env";
import { fetchBusyEvents } from "../../lib/icalFeed";
import {
  calendarEventsRateLimited,
  protectedProcedure,
  router,
  validateAthleteOwnership,
} from "../index";

/** Hex colour like "#64748b" — the only colour shape the UI emits. */
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a #rrggbb colour");

/** A subscribable iCal URL: http(s) only, length-bounded. */
const icalUrl = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "Must be an http(s) URL");

const name = z.string().trim().min(1).max(120);

export const calendarSubscriptionsRouter = router({
  /** The athlete's calendar subscriptions, ordered as shown in the UI. */
  list: protectedProcedure
    .input(z.object({ athleteId: z.number() }))
    .use(validateAthleteOwnership)
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(calendarSubscriptions)
        .where(eq(calendarSubscriptions.athlete, input.athleteId))
        .orderBy(
          asc(calendarSubscriptions.sortOrder),
          asc(calendarSubscriptions.id),
        );
    }),

  create: protectedProcedure
    .input(
      z.object({
        athleteId: z.number(),
        name,
        icalUrl,
        color: hexColor.default("#64748b"),
      }),
    )
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      // New calendars sort after existing ones.
      const [{ value: maxOrder } = { value: null }] = await ctx.db
        .select({ value: max(calendarSubscriptions.sortOrder) })
        .from(calendarSubscriptions)
        .where(eq(calendarSubscriptions.athlete, input.athleteId));
      const now = Date.now();
      const [created] = await ctx.db
        .insert(calendarSubscriptions)
        .values({
          athlete: input.athleteId,
          name: input.name,
          icalUrl: input.icalUrl,
          color: input.color,
          sortOrder: (maxOrder ?? -1) + 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return created;
    }),

  update: protectedProcedure
    .input(
      z.object({
        athleteId: z.number(),
        id: z.number(),
        name: name.optional(),
        icalUrl: icalUrl.optional(),
        color: hexColor.optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      const { athleteId, id, ...fields } = input;
      const result = await ctx.db
        .update(calendarSubscriptions)
        .set({ ...fields, updatedAt: Date.now() })
        .where(
          and(
            eq(calendarSubscriptions.id, id),
            eq(calendarSubscriptions.athlete, athleteId),
          ),
        )
        .returning({ id: calendarSubscriptions.id });
      if (result.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
    }),

  remove: protectedProcedure
    .input(z.object({ athleteId: z.number(), id: z.number() }))
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db
        .delete(calendarSubscriptions)
        .where(
          and(
            eq(calendarSubscriptions.id, input.id),
            eq(calendarSubscriptions.athlete, input.athleteId),
          ),
        )
        .returning({ id: calendarSubscriptions.id });
      if (result.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
    }),

  /**
   * Parsed busy events across all the athlete's subscriptions within a floating
   * local `[from, to]` window. Fetches + parses on demand (cached in-process);
   * one bad feed never breaks the rest. Rate-limited since it does outbound I/O.
   */
  events: protectedProcedure
    .input(
      z.object({
        athleteId: z.number(),
        // Floating local ISO bounds (e.g. "2026-05-28T00:00:00"), same clock the
        // grid positions activities by.
        from: z.string().min(1),
        to: z.string().min(1),
      }),
    )
    .use(validateAthleteOwnership)
    .use(calendarEventsRateLimited)
    .query(async ({ ctx, input }) => {
      return fetchBusyEvents(
        ctx.db,
        input.athleteId,
        input.from,
        input.to,
        env.CALENDAR_TIMEZONE,
      );
    }),
});
