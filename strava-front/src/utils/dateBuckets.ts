// Shared local-date bucketing helpers. `toDateKey` used to be duplicated
// (and re-derived slightly differently) in trainingLoad.ts and
// FormTrendCard.tsx; this is the one place that owns "which calendar day
// does this Strava activity belong to".
export type DayBucketActivity = {
  sport_type: string;
  distance: number; // meters
  start_date_local: string;
};

const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);

/** Parses Strava's start_date_local as a wall-clock local date. */
export function parseStravaLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z?)?$/.exec(value);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const hour = Number(match[4] ?? 0);
    const minute = Number(match[5] ?? 0);
    const second = Number(match[6] ?? 0);
    const date = new Date(year, month, day, hour, minute, second);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month ||
      date.getDate() !== day ||
      date.getHours() !== hour ||
      date.getMinutes() !== minute
    ) {
      return null;
    }
    return date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toDateKey(value: string): string | null {
  const date = parseStravaLocalDate(value);
  return date ? localDateKey(date) : null;
}

export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, offset: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + offset);
  return copy;
}

/** Per-day run km for every calendar day of `year` (Jan 1 -> Dec 31). */
export function buildYearBuckets(rows: DayBucketActivity[], year: number): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const activity of rows) {
    if (!RUN_TYPES.has(activity.sport_type)) continue;
    const key = toDateKey(activity.start_date_local);
    if (!key || !key.startsWith(`${year}-`)) continue;
    byDay.set(key, (byDay.get(key) ?? 0) + activity.distance / 1000);
  }

  const buckets = new Map<string, number>();
  let cursor = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  while (cursor <= end) {
    const key = localDateKey(cursor);
    buckets.set(key, byDay.get(key) ?? 0);
    cursor = addDays(cursor, 1);
  }
  return buckets;
}
