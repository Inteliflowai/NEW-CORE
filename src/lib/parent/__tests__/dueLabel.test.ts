import { describe, it, expect } from 'vitest';
import { formatDueLabel } from '@/lib/parent/dueLabel';

// Fixed "now": Wed 2026-06-10T12:00:00Z
const NOW = new Date('2026-06-10T12:00:00Z');

describe('formatDueLabel', () => {
  it('labels same-day as "Due today"', () => {
    expect(formatDueLabel('2026-06-10T20:00:00Z', NOW)).toBe('Due today');
  });
  it('labels next calendar day as "Due tomorrow"', () => {
    expect(formatDueLabel('2026-06-11T08:00:00Z', NOW)).toBe('Due tomorrow');
  });
  it('labels 2-6 days out with the weekday name', () => {
    // 2026-06-13 is a Saturday
    expect(formatDueLabel('2026-06-13T08:00:00Z', NOW)).toBe('Due Saturday');
  });
  it('labels 7-13 days out as "Due next week"', () => {
    expect(formatDueLabel('2026-06-18T08:00:00Z', NOW)).toBe('Due next week');
  });
  it('labels 14+ days out as "Due in a few weeks"', () => {
    expect(formatDueLabel('2026-07-05T08:00:00Z', NOW)).toBe('Due in a few weeks');
  });
  it('labels a past date as "Due soon" (defensive; filter should exclude these)', () => {
    expect(formatDueLabel('2026-06-01T08:00:00Z', NOW)).toBe('Due soon');
  });
  it('never emits a digit', () => {
    for (const iso of ['2026-06-10T20:00:00Z','2026-06-11T08:00:00Z','2026-06-13T08:00:00Z','2026-06-18T08:00:00Z','2026-07-05T08:00:00Z']) {
      expect(/\d/.test(formatDueLabel(iso, NOW))).toBe(false);
    }
  });
});
