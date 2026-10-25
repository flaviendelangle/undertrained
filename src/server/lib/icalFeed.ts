import { asc, eq } from "drizzle-orm";
import ICAL from "ical.js";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { Database } from "../db";
import { calendarSubscriptions } from "../db/schema";
import {
  tzOffsetMs,
  utcToZonedWallClock,
  zonedWallClockToUtc,
} from "./timezone";

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
/** Offsets cached per zone the feeds name without defining (a few MB at most). */
const MAX_ZONE_OFFSETS = 50_000;
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
  if (
    o.length !== 4 ||
    o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  ) {
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
  if (
    resolved.length === 0 ||
    resolved.some((r) => addressBlocked(r.address))
  ) {
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
 * In-process cache of parsed feeds keyed by URL (~15 min TTL), so paging across
 * weeks within a session neither refetches nor reparses. Single-instance VPS, so
 * a plain Map is enough — no Redis. The URL key lives only in memory.
 */
const feedCache = new Map<string, { fetchedAt: number; feed: ParsedFeed }>();

function pruneCache(now: number): void {
  for (const [key, entry] of feedCache) {
    if (now - entry.fetchedAt >= CACHE_TTL_MS) feedCache.delete(key);
  }
  if (feedCache.size > MAX_CACHE_ENTRIES) {
    const oldestFirst = [...feedCache.entries()].sort(
      (a, b) => a[1].fetchedAt - b[1].fetchedAt,
    );
    for (const [key] of oldestFirst.slice(
      0,
      feedCache.size - MAX_CACHE_ENTRIES,
    )) {
      feedCache.delete(key);
    }
  }
}

async function getFeed(rawUrl: string, now: number): Promise<ParsedFeed> {
  const cached = feedCache.get(rawUrl);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.feed;
  }
  const feed = parseFeed(await fetchIcs(rawUrl));
  feedCache.set(rawUrl, { fetchedAt: now, feed });
  pruneCache(now);
  return feed;
}

// ── Parse + normalize ────────────────────────────────────────────────────

/**
 * A zone ical.js resolves through `Intl`. Used for a TZID the feed names
 * without defining it in a VTIMEZONE (ical.js would read it as floating), so
 * that recurrence limits, EXDATEs and moved instances compare at the right
 * instant.
 */
class IntlTimezone extends ICAL.Timezone {
  /**
   * Offsets by wall clock. Recurrence expansion asks for the same instants on
   * every request, and each `Intl` lookup is slow.
   */
  private readonly offsets = new Map<number, number>();

  constructor(tzid: string) {
    super({ tzid });
  }

  override utcOffset(tt: ICAL.Time): number {
    const wallAsUtc = wallClockMs(tt);
    let offset = this.offsets.get(wallAsUtc);
    if (offset === undefined) {
      const instant = zonedWallClockToUtc(tt.toString(), this.tzid).getTime();
      offset = (wallAsUtc - instant) / 1000;
      if (this.offsets.size >= MAX_ZONE_OFFSETS) this.offsets.clear();
      this.offsets.set(wallAsUtc, offset);
    }
    return offset;
  }
}

/**
 * Register every IANA TZID the events use with ical.js's zone service, which
 * it falls back to when the feed has no VTIMEZONE for it. A feed's own
 * definition still wins.
 */
function registerNamedZones(vevents: ICAL.Component[]): void {
  for (const vevent of vevents) {
    for (const prop of vevent.getAllProperties()) {
      const tzid = prop.getParameter("tzid");
      if (typeof tzid !== "string" || ICAL.TimezoneService.has(tzid)) continue;
      try {
        tzOffsetMs(0, tzid);
      } catch {
        continue; // Not an IANA zone: ical.js reads it as floating.
      }
      ICAL.TimezoneService.register(new IntlTimezone(tzid));
    }
  }
}

/**
 * A feed parsed once per fetch. Each series is related to its own moved or
 * edited instances only: left alone, ical.js relates every RECURRENCE-ID event
 * in the feed to every event, which is quadratic and attaches one series'
 * moved instance to another series that happens to occur at the same time.
 */
export interface ParsedFeed {
  singles: ICAL.Event[];
  /** Events with an RRULE or RDATE. */
  series: ICAL.Event[];
  /** Moved or edited occurrences (RECURRENCE-ID), shown at their own time. */
  instances: ICAL.Event[];
}

export function parseFeed(ics: string): ParsedFeed {
  let vevents: ICAL.Component[];
  try {
    const jcal = ICAL.parse(ics) as unknown[];
    vevents = new ICAL.Component(jcal).getAllSubcomponents("vevent");
  } catch {
    throw new IcalFeedError("parse_error");
  }
  registerNamedZones(vevents);

  const instancesByUid = new Map<string, ICAL.Event[]>();
  const masters: ICAL.Component[] = [];
  for (const vevent of vevents) {
    if (!vevent.hasProperty("recurrence-id")) {
      masters.push(vevent);
      continue;
    }
    const instance = new ICAL.Event(vevent);
    const siblings = instancesByUid.get(instance.uid);
    if (siblings) siblings.push(instance);
    else instancesByUid.set(instance.uid, [instance]);
  }

  const feed: ParsedFeed = {
    singles: [],
    series: [],
    // A THISANDFUTURE edit shifts the occurrences after it, so it comes out of
    // its series' expansion instead.
    instances: [...instancesByUid.values()]
      .flat()
      .filter((instance) => !instance.modifiesFuture()),
  };
  for (const vevent of masters) {
    try {
      const event = new ICAL.Event(vevent, {
        exceptions:
          instancesByUid.get(String(vevent.getFirstPropertyValue("uid"))) ?? [],
      });
      (event.isRecurring() ? feed.series : feed.singles).push(event);
    } catch {
      // One malformed event must not sink the whole feed.
    }
  }
  return feed;
}

function isCancelled(event: ICAL.Event): boolean {
  const status = event.component.getFirstPropertyValue("status");
  return typeof status === "string" && status.toUpperCase() === "CANCELLED";
}

/** `YYYY-MM-DD` for a UTC-anchored millisecond timestamp. */
function isoDay(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10);
}

/** Days since the epoch of a time's own wall-clock date, whatever its zone. */
function dayNumber(time: ICAL.Time): number {
  return Date.UTC(time.year, time.month - 1, time.day) / MS_PER_DAY;
}

/**
 * The requested window, as instants and as padded wall-clock day numbers. No
 * UTC offset reaches a day, so anything outside `[firstDay, lastDay]` misses
 * the window and can be skipped before paying for a time zone conversion.
 */
interface TimeWindow {
  fromFloating: string;
  toFloating: string;
  after: number;
  before: number;
  firstDay: number;
  lastDay: number;
}

/**
 * The instant a timed value denotes. A floating time, or one whose TZID is
 * neither defined by the feed nor known to `Intl`, is read in the athlete's
 * zone.
 */
function instantMs(time: ICAL.Time, tz: string): number {
  if (time.zone?.tzid !== "floating") return time.toUnixTime() * 1000;
  return zonedWallClockToUtc(time.toString(), tz).getTime();
}

/**
 * Append one or more {@link BusyEvent}s for a single VEVENT occurrence, clamped to
 * the window. Timed events become one block; all-day events fan out to one entry
 * per covered local day.
 */
function pushEvent(
  out: BusyEvent[],
  sub: { subscriptionId: number; color: string },
  item: ICAL.Event,
  start: ICAL.Time,
  end: ICAL.Time,
  bounds: TimeWindow,
  tz: string,
): void {
  const title = (item.summary || "").trim();
  const { subscriptionId, color } = sub;

  if (start.isDate) {
    const fromDay = bounds.fromFloating.slice(0, 10);
    const toDay = bounds.toFloating.slice(0, 10);
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

  const startMs = instantMs(start, tz);
  let endMs = instantMs(end, tz);
  if (endMs < bounds.after || startMs > bounds.before) return;
  // Zero-length / inverted events still want a visible block: default to 30 min.
  if (endMs <= startMs) endMs = startMs + 30 * 60_000;
  out.push({
    subscriptionId,
    title,
    startLocal: utcToZonedWallClock(new Date(startMs), tz),
    endLocal: utcToZonedWallClock(new Date(endMs), tz),
    allDay: false,
    color,
  });
}

/** The last wall-clock day a series can start on, `Infinity` if open-ended. */
function seriesLastDay(event: ICAL.Event): number {
  if (event.component.hasProperty("rdate")) return Infinity;
  let last = -Infinity;
  for (const rrule of event.component.getAllProperties("rrule")) {
    const { until } = rrule.getFirstValue() as ICAL.Recur;
    if (!until) return Infinity;
    last = Math.max(last, dayNumber(until));
  }
  return last;
}

function lengthDays(event: ICAL.Event): number {
  return Math.max(0, Math.ceil(event.duration.toSeconds() / 86_400));
}

/** Milliseconds since the epoch of a time's own wall clock, whatever its zone. */
function wallClockMs(time: ICAL.Time): number {
  return Date.UTC(
    time.year,
    time.month - 1,
    time.day,
    time.hour,
    time.minute,
    time.second,
  );
}

/**
 * How many days a series' RANGE=THISANDFUTURE edits can move an occurrence
 * earlier or later, and the most days any of its occurrences lasts.
 */
function seriesReach(event: ICAL.Event): {
  earlier: number;
  later: number;
  length: number;
} {
  const reach = { earlier: 0, later: 0, length: lengthDays(event) };
  for (const edit of Object.values(event.exceptions)) {
    if (!edit.modifiesFuture()) continue;
    const shift = wallClockMs(edit.startDate) - wallClockMs(edit.recurrenceId);
    reach.earlier = Math.max(reach.earlier, Math.ceil(-shift / MS_PER_DAY));
    reach.later = Math.max(reach.later, Math.ceil(shift / MS_PER_DAY));
    reach.length = Math.max(reach.length, lengthDays(edit));
  }
  return reach;
}

/** Feed each occurrence of a series that can touch the window to `add`. */
function expandSeries(
  event: ICAL.Event,
  bounds: TimeWindow,
  add: (item: ICAL.Event, start: ICAL.Time, end: ICAL.Time) => void,
): void {
  // Days past an occurrence's original date that it can still cover.
  const { earlier, later, length } = seriesReach(event);
  const reach = later + length;
  // Expansion always starts at DTSTART, so a series that ended before the
  // window would walk its whole history for nothing.
  if (seriesLastDay(event) + reach < bounds.firstDay) return;
  const iterator = event.iterator();
  for (let i = 0; i < MAX_RECUR_ITERATIONS; i += 1) {
    const next = iterator.next();
    if (!next) return;
    const day = dayNumber(next);
    if (day - earlier > bounds.lastDay) return;
    if (day + reach < bounds.firstDay) continue;
    const details = event.getOccurrenceDetails(next);
    // Moved and edited instances are listed on their own, at their own time.
    if (details.item !== event && !details.item.modifiesFuture()) continue;
    add(details.item, details.startDate, details.endDate);
  }
}

/**
 * A parsed feed's events (incl. recurrences, honouring RRULE/RDATE/EXDATE,
 * moved instances and VTIMEZONE) within `[fromFloating, toFloating]`, as
 * {@link BusyEvent}s. Pure (no network / DB) so it's directly unit-testable.
 */
export function busyEventsBetween(
  feed: ParsedFeed,
  sub: { subscriptionId: number; color: string },
  fromFloating: string,
  toFloating: string,
  tz: string,
): BusyEvent[] {
  const after = zonedWallClockToUtc(fromFloating, tz).getTime();
  const before = zonedWallClockToUtc(toFloating, tz).getTime();
  const bounds: TimeWindow = {
    fromFloating,
    toFloating,
    after,
    before,
    firstDay: Math.floor(after / MS_PER_DAY) - 1,
    lastDay: Math.floor(before / MS_PER_DAY) + 1,
  };

  const out: BusyEvent[] = [];
  const add = (item: ICAL.Event, start: ICAL.Time, end: ICAL.Time): void => {
    if (out.length >= MAX_EVENTS_PER_FEED || isCancelled(item)) return;
    try {
      pushEvent(out, sub, item, start, end, bounds, tz);
    } catch {
      // One malformed event must not sink the whole feed.
    }
  };

  for (const event of [...feed.singles, ...feed.instances]) {
    try {
      const { startDate, endDate } = event;
      if (dayNumber(startDate) > bounds.lastDay) continue;
      if (dayNumber(endDate) < bounds.firstDay) continue;
      add(event, startDate, endDate);
    } catch {
      // One malformed event must not sink the whole feed.
    }
  }
  for (const event of feed.series) {
    try {
      expandSeries(event, bounds, add);
    } catch {
      // A series whose rule can't be expanded contributes nothing.
    }
  }
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
      return busyEventsBetween(
        await getFeed(sub.icalUrl, now),
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
      bookkeeping.push(
        recordOutcome(db, sub.id, now, sanitizeError(result.reason)),
      );
    }
  });
  await Promise.allSettled(bookkeeping);

  return events;
}
