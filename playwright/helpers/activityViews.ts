import "dotenv/config";
import { encode } from "next-auth/jwt";
import postgres from "postgres";
import superjson from "superjson";

import { test as base } from "@playwright/test";
import { createTRPCClient, httpLink } from "@trpc/client";

import type { AppRouter } from "../../src/server/trpc/root";

const origin = `http://localhost:${process.env.PORT ?? 3000}`;

export const test = base.extend<{
  viewsFixture: {
    athleteId: number;
    otherId: number;
    client: ReturnType<typeof createTRPCClient<AppRouter>>;
    otherClient: ReturnType<typeof createTRPCClient<AppRouter>>;
    ids: Record<string, number>;
  };
}>({
  viewsFixture: async ({ context }, use) => {
    const db = postgres(process.env.DATABASE_URL!);
    const seed = Date.now() * 100 + Math.floor(Math.random() * 90);
    const athletes = await db<
      { id: number }[]
    >`insert into athletes (strava_athlete_id,access_token,name) values (${seed},'test-unused','Saved view test'),(${seed + 1},'test-unused','Other athlete') returning id`;
    const [athleteId, otherId] = athletes.map((a) => a.id);
    try {
      const samples = [
        {
          key: "long",
          type: "Ride",
          distance: 50000,
          workout_type: 10,
          commute: false,
          watts: 200,
          map: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
        },
        {
          key: "race",
          type: "Run",
          distance: 12000,
          workout_type: 1,
          commute: false,
          watts: null,
          map: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
        },
        {
          key: "short",
          type: "Ride",
          distance: 20000,
          workout_type: 10,
          commute: false,
          watts: 900,
          map: null,
        },
        {
          key: "commute",
          type: "Ride",
          distance: 60000,
          workout_type: 10,
          commute: true,
          watts: 800,
          map: null,
        },
        {
          key: "easy",
          type: "Run",
          distance: 5000,
          workout_type: null,
          commute: false,
          watts: null,
          map: null,
        },
      ];
      const ids: Record<string, number> = {};
      for (const [index, sample] of samples.entries()) {
        ids[sample.key] = seed + 10 + index;
        const [row] = await db<
          { id: number }[]
        >`insert into activities ${db({ athlete: athleteId, strava_id: ids[sample.key], type: sample.type, name: sample.key === "long" ? "100% Alpine_ride" : sample.key, start_date: "2026-01-11T07:30:00Z", start_date_local: "2026-01-10T22:30:00", distance: sample.distance, total_elevation_gain: 500, average_speed: 5, moving_time: 3600, elapsed_time: 3600, workout_type: sample.workout_type, commute: sample.commute, average_watts: sample.watts, tss: 50, hrss: 50, power_bests: sample.watts ? db.json({ 60: sample.watts }) : null, map_polyline: sample.map, are_streams_loaded: true, are_best_efforts_loaded: true })} returning id`;
        if (sample.watts)
          await db`insert into activity_streams (activity_id,type,data,series_type,original_size,resolution) values (${row.id},'watts',${JSON.stringify([sample.watts, sample.watts])},'time',2,'high')`;
      }
      await db`insert into activities (athlete,strava_id,type,name,start_date,start_date_local,distance,total_elevation_gain,average_speed,moving_time,elapsed_time,power_bests) values (${otherId},${seed + 20},'Ride','Foreign ride','2026-01-10T12:00:00Z','2026-01-10T12:00:00',100000,100,5,3600,3600,'{"60":2000}'::jsonb)`;
      await db`update athletes set last_seen_activity_id = (select max(id) from activities where athlete=${athleteId}) where id=${athleteId}`;
      const tokenFor = (id: number) =>
        encode({
          secret: process.env.NEXTAUTH_SECRET!,
          token: { athleteId: id, name: "Saved view test", sub: String(id) },
          maxAge: 3600,
        });
      const [token, otherToken] = await Promise.all([
        tokenFor(athleteId),
        tokenFor(otherId),
      ]);
      await context.addCookies([
        {
          name: "next-auth.session-token",
          value: token,
          url: origin,
          httpOnly: true,
          sameSite: "Lax",
        },
        { name: "locale", value: "en-GB", url: origin },
      ]);
      const clientFor = (value: string) =>
        createTRPCClient<AppRouter>({
          links: [
            httpLink({
              url: `${origin}/api/trpc`,
              methodOverride: "POST",
              transformer: superjson,
              headers: { cookie: `next-auth.session-token=${value}` },
            }),
          ],
        });
      await use({
        athleteId,
        otherId,
        client: clientFor(token),
        otherClient: clientFor(otherToken),
        ids,
      });
    } finally {
      await db`delete from athletes where id in (${athleteId},${otherId})`;
      await db.end();
    }
  },
});
export { expect } from "@playwright/test";
export { origin };
