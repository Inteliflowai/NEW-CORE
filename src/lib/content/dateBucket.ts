// src/lib/content/dateBucket.ts
// Shared calendar-bucket date filter for the Content Studio libraries (Lesson + Quiz).
//
// "Today" / "This week" / "This month" mean the SAME thing on both library screens: calendar
// buckets in UTC, NOT rolling time windows. (The Quiz Library previously used rolling 24h/7d
// windows, which drifted from the Lesson Library's calendar buckets — this util unifies them.)
//
//   today → same UTC calendar day as `now`
//   week  → today + the prior 6 days (a 7-day calendar span, by day-start)
//   month → same UTC calendar month + year as `now`
//   all   → everything

export type DateBucket = 'all' | 'month' | 'week' | 'today';

const MS_DAY = 24 * 60 * 60 * 1000;

/** UTC calendar-day start (midnight) for `d`, as epoch ms. */
function dayStart(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** True if `createdIso` falls inside the chosen calendar bucket, relative to `now`. */
export function inBucket(createdIso: string, bucket: DateBucket, now: Date): boolean {
  if (bucket === 'all') return true;
  if (!createdIso) return false;
  const created = new Date(createdIso);
  if (Number.isNaN(created.getTime())) return false;
  if (bucket === 'today') return dayStart(created) === dayStart(now);
  if (bucket === 'week') {
    const sevenDaysAgo = dayStart(now) - 6 * MS_DAY; // today + the prior 6 days
    return dayStart(created) >= sevenDaysAgo;
  }
  // month — same UTC calendar month + year as now.
  return created.getUTCFullYear() === now.getUTCFullYear() && created.getUTCMonth() === now.getUTCMonth();
}
