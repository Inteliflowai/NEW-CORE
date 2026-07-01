// src/lib/parent/dueLabel.ts
// Pure, digit-free due-date label for parent surfaces. Compares UTC calendar
// days (deterministic + testable). "no digits in date" (spec §2a).

const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Digit-free "Due …" label. `now` is injected for determinism. */
export function formatDueLabel(dueAtIso: string, now: Date): string {
  const due = new Date(dueAtIso);
  const diffDays = Math.round((utcMidnight(due) - utcMidnight(now)) / 86_400_000);
  if (diffDays < 0) return 'Due soon';
  if (diffDays === 0) return 'Due today';
  if (diffDays === 1) return 'Due tomorrow';
  if (diffDays <= 6) return `Due ${WEEKDAYS[due.getUTCDay()]}`;
  if (diffDays <= 13) return 'Due next week';
  return 'Due in a few weeks';
}
