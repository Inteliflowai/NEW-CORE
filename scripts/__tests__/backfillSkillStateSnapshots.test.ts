// scripts/__tests__/backfillSkillStateSnapshots.test.ts
import { describe, it, expect } from 'vitest';
import { buildSkillStateHistoryRows } from '../backfillSkillStateSnapshots';

it('emits one row per (student, skill, week) trending toward solid states', () => {
  const rows = buildSkillStateHistoryRows({
    studentIds: ['s1', 's2'], skillIds: ['sk1'], weeks: 4,
    refDate: new Date('2026-06-08T00:00:00Z'), schoolId: 'sch1',
  });
  expect(rows).toHaveLength(2 * 1 * 4); // 8
  const dates = [...new Set(rows.map((r) => r.snapshot_date))].sort();
  expect(dates).toHaveLength(4);
  const solid = (s: string) => s === 'on_track' || s === 'ready_to_extend';
  const earliest = rows.filter((r) => r.snapshot_date === dates[0]);
  const latest = rows.filter((r) => r.snapshot_date === dates[dates.length - 1]);
  expect(latest.filter((r) => solid(r.state)).length).toBeGreaterThan(earliest.filter((r) => solid(r.state)).length);
});
