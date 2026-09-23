import { and, desc, eq } from "drizzle-orm";
import type { NextApiRequest, NextApiResponse } from "next";

import { db } from "~/server/db";
import {
  athletes,
  riderSettings,
  structuredWorkouts,
} from "~/server/db/schema";
import { desktopBuiltInWorkouts } from "~/server/lib/desktopBuiltInWorkouts";
import { desktopAthlete } from "~/server/lib/desktopSession";
import {
  desktopReferenceFtp,
  desktopWorkoutExecution,
} from "~/server/lib/desktopWorkoutExecution";
import { summarizeWorkout } from "~/server/lib/workoutSummary";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Allow", "GET");
  if (req.method !== "GET") return res.status(405).end();
  const athlete = await desktopAthlete(req.headers.authorization);
  if (!athlete) return res.status(401).end();
  const requestedLocale = req.query?.locale;
  if (
    requestedLocale !== undefined &&
    requestedLocale !== "en-GB" &&
    requestedLocale !== "fr-FR"
  ) {
    return res.status(400).json({ error: "Unsupported locale" });
  }
  const rows = await db
    .select()
    .from(structuredWorkouts)
    .where(
      and(
        eq(structuredWorkouts.athlete, athlete.id),
        eq(structuredWorkouts.sport, "bike"),
      ),
    )
    .orderBy(desc(structuredWorkouts.updatedAt), desc(structuredWorkouts.id));
  const [settings, account] = await Promise.all([
    db.query.riderSettings.findFirst({
      where: eq(riderSettings.athlete, athlete.id),
    }),
    db.query.athletes.findFirst({
      where: eq(athletes.id, athlete.id),
      columns: { language: true },
    }),
  ]);
  const referenceFtp = desktopReferenceFtp(settings);
  return res.json({
    builtInWorkouts: desktopBuiltInWorkouts(
      settings,
      requestedLocale ?? account?.language,
    ),
    workouts: rows
      .map((row) => ({
        ...summarizeWorkout(row),
        execution: desktopWorkoutExecution(row.structure, referenceFtp),
      }))
      .map(
        ({
          id,
          name,
          durationSeconds,
          estimatedTss,
          summary,
          profile,
          execution,
        }) => ({
          id,
          name,
          durationSeconds,
          estimatedTss,
          summary,
          execution,
          // Desktop protocol uses percentages: 80 means 80% FTP.
          profile: profile.map(([seconds, ratio]) => [
            seconds,
            ratio == null ? null : ratio * 100,
          ]),
        }),
      ),
  });
}
