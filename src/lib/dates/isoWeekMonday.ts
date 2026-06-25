// src/lib/dates/isoWeekMonday.ts
// Import-safe (no next/server) ISO-week-Monday helper, shared by the weekly-snapshot cron and
// the demo backfill script. Deterministic: the caller passes the reference date.
// ISO week: Monday = 1 … Sunday = 0. Offset: dow === 0 (Sun) → -6 days; else 1 − dow.
export function isoWeekMonday(ref: Date): string {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  const dow = d.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}
