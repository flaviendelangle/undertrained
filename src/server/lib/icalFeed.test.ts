import { describe, expect, it } from "vitest";

import { assertSafeUrl, eventsFromIcs, IcalFeedError } from "./icalFeed";

const TZ = "Europe/Paris";
const SUB = { subscriptionId: 7, color: "#64748b" };

/** Wrap VEVENT bodies in a minimal valid VCALENDAR. */
function ics(...vevents: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//EN",
    ...vevents.flatMap((v) => ["BEGIN:VEVENT", v, "END:VEVENT"]),
    "END:VCALENDAR",
  ].join("\r\n");
}

describe("eventsFromIcs — timed events", () => {
  it("converts an absolute UTC instant to the athlete's local wall-clock", () => {
    // 10:00Z in summer is 12:00 in Paris (CEST, +2).
    const feed = ics(
      [
        "UID:summer@test",
        "DTSTART:20260801T100000Z",
        "DTEND:20260801T110000Z",
        "SUMMARY:Dentist",
      ].join("\r\n"),
    );
    const out = eventsFromIcs(feed, SUB, "2026-07-25T00:00:00", "2026-08-10T00:00:00", TZ);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      subscriptionId: 7,
      title: "Dentist",
      allDay: false,
      startLocal: "2026-08-01T12:00:00",
      endLocal: "2026-08-01T13:00:00",
      color: "#64748b",
    });
  });

  it("honours DST: the same UTC hour maps to +1 in winter", () => {
    // 10:00Z in winter is 11:00 in Paris (CET, +1).
    const feed = ics(
      [
        "UID:winter@test",
        "DTSTART:20260201T100000Z",
        "DTEND:20260201T103000Z",
        "SUMMARY:Standup",
      ].join("\r\n"),
    );
    const out = eventsFromIcs(feed, SUB, "2026-01-25T00:00:00", "2026-02-10T00:00:00", TZ);
    expect(out).toHaveLength(1);
    expect(out[0].startLocal).toBe("2026-02-01T11:00:00");
    expect(out[0].endLocal).toBe("2026-02-01T11:30:00");
  });

  it("defaults a zero-length event to a 30-minute block", () => {
    const feed = ics(
      [
        "UID:instant@test",
        "DTSTART:20260201T080000Z",
        "DTEND:20260201T080000Z",
        "SUMMARY:Reminder",
      ].join("\r\n"),
    );
    const out = eventsFromIcs(feed, SUB, "2026-01-25T00:00:00", "2026-02-10T00:00:00", TZ);
    expect(out[0].startLocal).toBe("2026-02-01T09:00:00");
    expect(out[0].endLocal).toBe("2026-02-01T09:30:00");
  });
});

describe("eventsFromIcs — all-day events", () => {
  it("flags a date-only event as all-day without shifting the date", () => {
    const feed = ics(
      [
        "UID:allday@test",
        "DTSTART;VALUE=DATE:20260610",
        "DTEND;VALUE=DATE:20260611",
        "SUMMARY:Day off",
      ].join("\r\n"),
    );
    const out = eventsFromIcs(feed, SUB, "2026-06-01T00:00:00", "2026-06-30T00:00:00", TZ);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      allDay: true,
      startLocal: "2026-06-10T00:00:00",
      endLocal: "2026-06-10T23:59:59",
    });
  });

  it("fans a multi-day all-day span out to one entry per covered day", () => {
    const feed = ics(
      [
        "UID:trip@test",
        "DTSTART;VALUE=DATE:20260610",
        "DTEND;VALUE=DATE:20260613", // exclusive → covers 10, 11, 12
        "SUMMARY:Trip",
      ].join("\r\n"),
    );
    const out = eventsFromIcs(feed, SUB, "2026-06-01T00:00:00", "2026-06-30T00:00:00", TZ);
    expect(out.map((e) => e.startLocal.slice(0, 10))).toEqual([
      "2026-06-10",
      "2026-06-11",
      "2026-06-12",
    ]);
    expect(out.every((e) => e.allDay)).toBe(true);
  });
});

describe("eventsFromIcs — recurrence", () => {
  it("expands a weekly RRULE and honours EXDATE", () => {
    // Weekly on Mondays from Feb 2; skip Feb 9 via EXDATE.
    const feed = ics(
      [
        "UID:weekly@test",
        "DTSTART:20260202T090000Z",
        "DTEND:20260202T100000Z",
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "EXDATE:20260209T090000Z",
        "SUMMARY:Weekly sync",
      ].join("\r\n"),
    );
    const out = eventsFromIcs(feed, SUB, "2026-02-01T00:00:00", "2026-03-01T00:00:00", TZ);
    const days = out.map((e) => e.startLocal.slice(0, 10));
    expect(days).toContain("2026-02-02");
    expect(days).not.toContain("2026-02-09"); // excluded
    expect(days).toContain("2026-02-16");
    expect(days).toContain("2026-02-23");
    // Every instance keeps the 09:00Z → 10:00 Paris (winter, +1) wall-clock.
    expect(out.every((e) => e.startLocal.endsWith("T10:00:00"))).toBe(true);
  });

  it("drops cancelled events", () => {
    const feed = ics(
      [
        "UID:cancelled@test",
        "DTSTART:20260201T090000Z",
        "DTEND:20260201T100000Z",
        "STATUS:CANCELLED",
        "SUMMARY:Cancelled",
      ].join("\r\n"),
    );
    const out = eventsFromIcs(feed, SUB, "2026-01-25T00:00:00", "2026-02-10T00:00:00", TZ);
    expect(out).toHaveLength(0);
  });

  it("excludes events outside the requested window", () => {
    const feed = ics(
      [
        "UID:far@test",
        "DTSTART:20270101T090000Z",
        "DTEND:20270101T100000Z",
        "SUMMARY:Next year",
      ].join("\r\n"),
    );
    const out = eventsFromIcs(feed, SUB, "2026-01-01T00:00:00", "2026-02-01T00:00:00", TZ);
    expect(out).toHaveLength(0);
  });
});

describe("assertSafeUrl — SSRF guard", () => {
  it("rejects loopback, link-local metadata, and non-http protocols", async () => {
    await expect(assertSafeUrl("http://127.0.0.1/cal.ics")).rejects.toBeInstanceOf(
      IcalFeedError,
    );
    await expect(
      assertSafeUrl("http://169.254.169.254/latest/meta-data"),
    ).rejects.toBeInstanceOf(IcalFeedError);
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toBeInstanceOf(
      IcalFeedError,
    );
    await expect(assertSafeUrl("http://10.0.0.5/x.ics")).rejects.toBeInstanceOf(
      IcalFeedError,
    );
    await expect(assertSafeUrl("http://[::1]/x.ics")).rejects.toBeInstanceOf(
      IcalFeedError,
    );
  });

  it("accepts a public IP literal over https", async () => {
    const url = await assertSafeUrl("https://1.1.1.1/calendar.ics");
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("1.1.1.1");
  });
});
