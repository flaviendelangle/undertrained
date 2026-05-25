import type { NextApiRequest, NextApiResponse } from "next";

import { addDays, addSeconds, format, subDays } from "date-fns";
import { and, eq, gte, lte } from "drizzle-orm";

import { db } from "@server/db";
import { athletes, plannedTrainings } from "@server/db/schema";
import type { PlannedTraining } from "@server/db/types";
import { env } from "@server/env";

// How much of the schedule the feed exposes, matching TrainingPeaks' window.
const HISTORY_DAYS = 5;
const FUTURE_DAYS = 14;

/** Escape a text value per RFC 5545 (commas, semicolons, backslashes, newlines). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Fold a content line to 75 octets per RFC 5545 (continuation lines start with a space). */
function foldLine(line: string): string {
  if (line.length <= 75) {
    return line;
  }
  const chunks: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    chunks.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  chunks.push(` ${rest}`);
  return chunks.join("\r\n");
}

/** UTC timestamp, e.g. "20260522T123456Z". */
function toUtcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Milliseconds `timeZone` is ahead of UTC at the given absolute instant. */
function tzOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const f = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    f("year"),
    f("month") - 1,
    f("day"),
    f("hour"),
    f("minute"),
    f("second"),
  );
  return asUtc - utcMs;
}

/**
 * Resolve a floating wall-clock datetime (e.g. "2026-05-25T07:00:00", no offset)
 * to the absolute UTC instant it denotes in `timeZone`. DST-aware via `Intl` —
 * the second pass corrects the offset when the first guess lands on the far side
 * of a DST transition. Stored plan times are floating, so this anchors them to
 * the athlete's zone rather than letting the calendar guess (Google assumes UTC).
 */
function zonedWallClockToUtc(floating: string, timeZone: string): Date {
  const [datePart, timePart = "00:00:00"] = floating.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi, s] = timePart.slice(0, 8).split(":").map(Number);
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  let utc = wallAsUtc - tzOffsetMs(wallAsUtc, timeZone);
  utc = wallAsUtc - tzOffsetMs(utc, timeZone);
  return new Date(utc);
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m}min`;
}

function buildEvent(row: PlannedTraining, dtstamp: string): string {
  const start = zonedWallClockToUtc(row.plannedDate, env.CALENDAR_TIMEZONE);
  const end = addSeconds(start, row.durationSeconds);
  const description = `${row.sportType} · ${formatDuration(row.durationSeconds)}`;
  const lines = [
    "BEGIN:VEVENT",
    // Stable UID so a calendar updates the event in place rather than duplicating.
    `UID:planned-${row.id}@undertrained`,
    `DTSTAMP:${dtstamp}`,
    // Absolute UTC instants (Z) — universally honored, unlike floating times.
    `DTSTART:${toUtcStamp(start)}`,
    `DTEND:${toUtcStamp(end)}`,
    foldLine(`SUMMARY:${escapeText(row.title)}`),
    foldLine(`DESCRIPTION:${escapeText(description)}`),
    "END:VEVENT",
  ];
  return lines.join("\r\n");
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }

  const tokenParam = req.query.token;
  // The dynamic segment is "{token}.ics" — strip the extension.
  const raw = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam;
  const token = raw?.replace(/\.ics$/, "");
  if (!token) {
    return res.status(404).end();
  }

  const athlete = await db.query.athletes.findFirst({
    where: eq(athletes.calendarToken, token),
  });
  if (!athlete) {
    return res.status(404).end();
  }

  const now = new Date();
  const from = format(subDays(now, HISTORY_DAYS), "yyyy-MM-dd'T'00:00:00");
  const to = format(addDays(now, FUTURE_DAYS), "yyyy-MM-dd'T'23:59:59");

  const rows = await db
    .select()
    .from(plannedTrainings)
    .where(
      and(
        eq(plannedTrainings.athlete, athlete.id),
        // Both "planned" and "completed" — once a plan is linked to a Strava
        // activity it should stay on the calendar (same UID, updated in place),
        // not vanish.
        gte(plannedTrainings.plannedDate, from),
        lte(plannedTrainings.plannedDate, to),
      ),
    );

  const dtstamp = toUtcStamp(now);
  const calName = athlete.name
    ? `Undertrained — ${athlete.name}'s Planned Training`
    : "Undertrained — Planned Training";
  const calendar = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//undertrained//Planned Training//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    foldLine(`X-WR-CALNAME:${escapeText(calName)}`),
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...rows.map((row) => buildEvent(row, dtstamp)),
    "END:VCALENDAR",
  ].join("\r\n");

  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'inline; filename="undertrained.ics"',
  );
  res.setHeader("Cache-Control", "private, max-age=300");
  return res.status(200).send(calendar);
}
