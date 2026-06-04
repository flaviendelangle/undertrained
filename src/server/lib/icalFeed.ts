import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { asc, eq } from "drizzle-orm";
import IcalExpander from "ical-expander";
import type ICAL from "ical.js";

import type { Database } from "../db";
import { calendarSubscriptions } from "../db/schema";
import { utcToZonedWallClock, zonedWallClockToUtc } from "./timezone";

/**
 * One external-calendar event, reduced to what the Journal week grid needs. Times
 * are **floating-local** ISO (`YYYY-MM-DDTHH:mm:ss`, no offset) so they drop
 * straight onto the grid via `weekGrid.minutesFromIso` — the same contract as a
 * planned training's `plannedDate`. All-day events carry `allDay: true` and are
 * emitted once per covered local day (so a multi-day span shows on every day).
 */
export interface BusyEvent {
  subscriptionId: number;
  /** Event summary; empty when the feed hides it (frontend shows a "Busy" label). */
  title: string;
  startLocal: string;
  endLocal: string;
  allDay: boolean;
  color: string;
}

const FETCH_TIMEOUT_MS = 8_000;
const MAX_FEED_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_RECUR_ITERATIONS = 2_000;
/** Hard cap on events returned per feed, so a pathological calendar can't OOM us. */
const MAX_EVENTS_PER_FEED = 2_000;
/** Cap multi-day all-day expansion so an open-ended span can't balloon. */
const MAX_ALLDAY_SPAN_DAYS = 90;
const CACHE_TTL_MS = 15 * 60_000;
const MAX_CACHE_ENTRIES = 50;
const MS_PER_DAY = 86_400_000;

/**
 * A coarse, URL-free failure code surfaced to the athlete (and stored in
 * `lastError`). The raw error is never used as the message — feed bodies and the
 * secret URL must never leak into logs or the DB.
 */
export class IcalFeedError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "IcalFeedError";
  }
}

// ── SSRF guard ─────────────────────────────────────────────────────────

/** True when an IPv4 literal falls in a private / loopback / reserved range. */
function ipv4Blocked(ip: string): boolean {
  const o = ip.split(".").map(Number);
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = o;
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast (224/4) + reserved (240/4)
  return false;
}

/** True when an IPv6 literal is loopback / unspecified / link-local / unique-local. */
function ipv6Blocked(ip: string): boolean {
  const addr = ip.toLowerCase().split("%")[0]; // drop any zone id
  if (addr === "::1" || addr === "::") return true;
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(addr);
  if (mapped) return ipv4Blocked(mapped[1]); // IPv4-mapped → defer to v4 rules
  const head = parseInt(addr.split(":")[0] || "0", 16);
  if (Number.isNaN(head)) return true;
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  return false;
}

function addressBlocked(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return ipv4Blocked(ip);
  if (family === 6) return ipv6Blocked(ip);
  return true; // unparseable → block
}

/**
 * Validate a user-supplied feed URL before we fetch it server-side: http(s) only,
 * and every IP the host resolves to must be public. Defends against SSRF — hitting
 * the cloud metadata endpoint, internal services, or `file://`. Re-run on each
 * redirect hop (a 302 to an internal host would otherwise bypass this).
 */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new IcalFeedError("invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new IcalFeedError("unsupported_protocol");
  }
  const host = url.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (isIP(host)) {
    if (addressBlocked(host)) throw new IcalFeedError("blocked_address");
    return url;
  }
  let resolved: { address: string }[];
  try {
    resolved = await lookup(host, { all: true });
  } catch {
    throw new IcalFeedError("dns_failure");
  }
  if (resolved.length === 0 || resolved.some((r) => addressBlocked(r.address))) {
    throw new IcalFeedError("blocked_address");
  }
  return url;
}

// ── Fetch ──────────────────────────────────────────────────────────────

/** Read a response body up to `maxBytes`, aborting if it would exceed the cap. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new IcalFeedError("feed_too_large");
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Fetch the raw `.ics` text, following (and re-validating) redirects manually. */
async function fetchIcs(rawUrl: string): Promise<string> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = await assertSafeUrl(current);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: "text/calendar, text/plain;q=0.9, */*;q=0.5" },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new IcalFeedError("bad_redirect");
      await res.body?.cancel();
      current = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new IcalFeedError(`http_${res.status}`);
    }
    return readCapped(res, MAX_FEED_BYTES);
  }
  throw new IcalFeedError("too_many_redirects");
}

/**
 * In-process cache of raw feed text keyed by URL (~15 min TTL), so paging across
 * weeks within a session doesn't refetch. Single-instance VPS, so a plain Map is
 * enough — no Redis. The URL key lives only in memory.
 */
const feedCache = new Map<string, { fetchedAt: number; ics: string }>();

function pruneCache(now: number): void {
  for (const [key, entry] of feedCache) {
    if (now - entry.fetchedAt >= CACHE_TTL_MS) feedCache.delete(key);
  }
  if (feedCache.size > MAX_CACHE_ENTRIES) {
    const oldestFirst = [...feedCache.entries()].sort(
      (a, b) => a[1].fetchedAt - b[1].fetchedAt,
    );
    for (const [key] of oldestFirst.slice(0, feedCache.size - MAX_CACHE_ENTRIES)) {
      feedCache.delete(key);
    }
  }
}

async function getIcs(rawUrl: string, now: number): Promise<string> {
  const cached = feedCache.get(rawUrl);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.ics;
  }
  const ics = await fetchIcs(rawUrl);
  feedCache.set(rawUrl, { fetchedAt: now, ics });
  pruneCache(now);
  return ics;
}

// ── Parse + normalize ────────────────────────────────────────────────────

function isCancelled(event: ICAL.Event): boolean {
  const status = event.component.getFirstPropertyValue("status");
  return typeof status === "string" && status.toUpperCase() === "CANCELLED";
}

/** `YYYY-MM-DD` for a UTC-anchored millisecond timestamp. */
function isoDay(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10);
}

/**
 * Append one or more {@link BusyEvent}s for a single VEVENT occurrence, clamped to
 * the `[fromFloating, toFloating]` window. Timed events become one block; all-day
 * events fan out to one entry per covered local day.
 */
function pushEvent(
  out: BusyEvent[],
  subscriptionId: number,
  color: string,
  summary: string,
  start: ICAL.Time,
  end: ICAL.Time,
  fromFloating: string,
  toFloating: string,
  tz: string,
): void {
  const title = (summary || "").trim();
  const fromDay = fromFloating.slice(0, 10);
  const toDay = toFloating.slice(0, 10);

  if (start.isDate) {
    const startMs = Date.UTC(start.year, start.month - 1, start.day);
    // iCal all-day DTEND is exclusive; a single-day event has end = start + 1 day.
    let endMs = Date.UTC(end.year, end.month - 1, end.day);
    if (endMs <= startMs) endMs = startMs + MS_PER_DAY;
    const spanDays = Math.min(
      MAX_ALLDAY_SPAN_DAYS,
      Math.round((endMs - startMs) / MS_PER_DAY),
    );
    for (let i = 0; i < spanDays; i += 1) {
      const day = isoDay(startMs + i * MS_PER_DAY);
      if (day < fromDay || day > toDay) continue;
      out.push({
        subscriptionId,
        title,
        startLocal: `${day}T00:00:00`,
        endLocal: `${day}T23:59:59`,
        allDay: true,
        color,
      });
    }
    return;
  }

  const startLocal = utcToZonedWallClock(start.toJSDate(), tz);
  let endLocal = utcToZonedWallClock(end.toJSDate(), tz);
  // Zero-length / inverted events still want a visible block: default to 30 min.
  if (endLocal <= startLocal) {
    endLocal = utcToZonedWallClock(
      new Date(start.toJSDate().getTime() + 30 * 60_000),
      tz,
    );
  }
  out.push({
    subscriptionId,
    title,
    startLocal,
    endLocal,
    allDay: false,
    color,
  });
}

/**
 * Parse a raw `.ics` string and expand its events (incl. recurrences, honouring
 * RRULE/EXDATE/VTIMEZONE) within `[fromFloating, toFloating]` into {@link BusyEvent}s.
 * Pure (no network / DB) so it's directly unit-testable.
 */
export function eventsFromIcs(
  ics: string,
  sub: { subscriptionId: number; color: string },
  fromFloating: string,
  toFloating: string,
  tz: string,
): BusyEvent[] {
  let expander: IcalExpander;
  try {
    expander = new IcalExpander({
      ics,
      maxIterations: MAX_RECUR_ITERATIONS,
      skipInvalidDates: true,
    });
  } catch {
    throw new IcalFeedError("parse_error");
  }

  const after = zonedWallClockToUtc(fromFloating, tz);
  const before = zonedWallClockToUtc(toFloating, tz);
  const { events, occurrences } = expander.between(after, before);

  const out: BusyEvent[] = [];
  const add = (
    event: ICAL.Event,
    start: ICAL.Time,
    end: ICAL.Time,
  ): void => {
    if (out.length >= MAX_EVENTS_PER_FEED || isCancelled(event)) return;
    try {
      pushEvent(
        out,
        sub.subscriptionId,
        sub.color,
        event.summary,
        start,
        end,
        fromFloating,
        toFloating,
        tz,
      );
    } catch {
      // One malformed event must not sink the whole feed.
    }
  };

  for (const event of events) add(event, event.startDate, event.endDate);
  for (const occ of occurrences) add(occ.item, occ.startDate, occ.endDate);
  return out;
}

// ── Public entry point ───────────────────────────────────────────────────

/** Map an arbitrary fetch/parse failure to a coarse, URL-free code. */
function sanitizeError(reason: unknown): string {
  if (reason instanceof IcalFeedError) return reason.code;
  if (reason instanceof Error) {
    if (reason.name === "TimeoutError" || reason.name === "AbortError") {
      return "timeout";
    }
    if (reason.name === "SyntaxError") return "parse_error";
  }
  return "fetch_error";
}

/** Best-effort: record a feed's last fetch outcome; never throw into the read path. */
async function recordOutcome(
  db: Database,
  id: number,
  now: number,
  error: string | null,
): Promise<void> {
  try {
    await db
      .update(calendarSubscriptions)
      .set({ lastFetchedAt: now, lastError: error })
      .where(eq(calendarSubscriptions.id, id));
  } catch {
    // Bookkeeping must not break event loading.
  }
}

/**
 * Fetch + parse every calendar the athlete subscribes to, returning the union of
 * their events within the floating-local `[from, to]` window. Each feed is handled
 * in isolation (`allSettled`), so one unreachable or malformed feed never breaks
 * the others — it just records a `lastError` and contributes nothing.
 */
export async function fetchBusyEvents(
  db: Database,
  athleteId: number,
  fromFloating: string,
  toFloating: string,
  tz: string,
): Promise<BusyEvent[]> {
  const subs = await db
    .select()
    .from(calendarSubscriptions)
    .where(eq(calendarSubscriptions.athlete, athleteId))
    .orderBy(asc(calendarSubscriptions.sortOrder));
  if (subs.length === 0) return [];

  const now = Date.now();
  const settled = await Promise.allSettled(
    subs.map(async (sub) => {
      const ics = await getIcs(sub.icalUrl, now);
      return eventsFromIcs(
        ics,
        { subscriptionId: sub.id, color: sub.color },
        fromFloating,
        toFloating,
        tz,
      );
    }),
  );

  const events: BusyEvent[] = [];
  const bookkeeping: Promise<void>[] = [];
  settled.forEach((result, i) => {
    const sub = subs[i];
    if (result.status === "fulfilled") {
      events.push(...result.value);
      bookkeeping.push(recordOutcome(db, sub.id, now, null));
    } else {
      bookkeeping.push(recordOutcome(db, sub.id, now, sanitizeError(result.reason)));
    }
  });
  await Promise.allSettled(bookkeeping);

  return events;
}
