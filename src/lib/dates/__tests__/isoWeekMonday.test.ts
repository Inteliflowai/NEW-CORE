import { describe, it, expect } from 'vitest';
import { isoWeekMonday } from '@/lib/dates/isoWeekMonday';

describe('isoWeekMonday', () => {
  it('returns the ISO-week Monday (UTC) for a midweek date', () => {
    expect(isoWeekMonday(new Date('2026-05-13T00:00:00Z'))).toBe('2026-05-11'); // Wed → Mon
  });
  it('maps Sunday back to the prior Monday', () => {
    expect(isoWeekMonday(new Date('2026-05-17T00:00:00Z'))).toBe('2026-05-11'); // Sun → Mon
  });
});
