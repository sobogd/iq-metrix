// Europe/Madrid wall-clock helpers. Everything the admin anchors to the
// owner's timezone (summary "today", salt rotation in lib/salt.ts, the
// nightly bot reclassification) uses the same clock. Times are computed via
// ICU so CET/CEST transitions are exact regardless of the server's TZ.

export const MADRID_TZ = "Europe/Madrid";

interface Ymd {
  y: number;
  m: number;
  d: number;
}

/** Calendar date (y/m/d) that `date` shows on a Europe/Madrid clock. */
export function madridYmd(date: Date): Ymd {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MADRID_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** Europe/Madrid's UTC offset (wall clock − UTC) at `date`, in ms. Read via
 *  ICU's formatToParts: format `date` in Madrid and re-read that wall clock
 *  as if it were UTC — the difference is the offset. Handles DST exactly,
 *  including both offset hours of Europe/Madrid (CET/CEST). */
export function madridOffsetMs(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MADRID_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === t)?.value);
  const wallAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wallAsUtc - date.getTime();
}

/** [00:00, 24:00) of the current Madrid calendar day, as UTC instants.
 *
 *  Madrid midnight is `offset` hours behind the UTC midnight of the same
 *  wall date, and Europe/Madrid's DST transitions happen at ≥ 01:00 UTC, so
 *  the offset probed at 00:00 UTC is always the offset in force at the day's
 *  start. */
export function madridDayBounds(now: Date): { start: Date; end: Date } {
  const { y, m, d } = madridYmd(now);
  const utcMidnight = Date.UTC(y, m - 1, d);
  const start = new Date(utcMidnight - madridOffsetMs(new Date(utcMidnight)));
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

/** Milliseconds from `now` until the next `hh:mm` on the Madrid clock. */
export function madridDelayUntil(now: Date, hour: number, minute: number): number {
  const { y, m, d } = madridYmd(now);
  const utcMidnight = Date.UTC(y, m - 1, d);
  const dayStart = utcMidnight - madridOffsetMs(new Date(utcMidnight));
  let target = dayStart + hour * 3600_000 + minute * 60_000;
  if (target <= now.getTime()) target += 86_400_000;
  return target - now.getTime();
}

/** "YYYY-MM-DD" — the Madrid calendar date `date` falls on. Fixed-width, so
 *  two keys compare (and sort) chronologically as plain strings. */
export function madridDayKey(date: Date): string {
  const { y, m, d } = madridYmd(date);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** [00:00, 24:00) of the Madrid calendar day a "YYYY-MM-DD" key names, as UTC
 *  instants. Rejects malformed or non-calendar keys ("2026-13-01", "2026-02-30")
 *  with null — the caller falls back to today. Same offset probe as
 *  madridDayBounds. */
export function madridBoundsFromKey(key: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const utcMidnight = Date.UTC(y, mo - 1, d);
  // Date.UTC rolls invalid months/days over ("2026-13-01" → 2027-01-01), so
  // round-trip to prove the key names a real calendar date.
  const check = new Date(utcMidnight);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  const start = new Date(utcMidnight - madridOffsetMs(new Date(utcMidnight)));
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

/** A "YYYY-MM-DD" key shifted by whole days (delta may be negative). The key
 *  space maps 1:1 onto calendar dates, so plain UTC day arithmetic is exact
 *  regardless of Madrid's DST. */
export function shiftMadridDay(key: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return key;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + delta));
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
