import { describe, it, expect } from 'vitest';
import { NAV_ENTRIES, isGroup, matchActive } from '../navConfig';

describe('navConfig', () => {
  it('has 9 destinations and 3 group labels, no "Homework"', () => {
    const labels: string[] = [];
    for (const e of NAV_ENTRIES) {
      if (isGroup(e)) {
        labels.push(e.groupLabel);
        e.items.forEach((i) => labels.push(i.label));
      } else {
        labels.push(e.label);
      }
    }
    for (const l of [
      'Today', 'Roster', 'Gradebook', 'Alerts', 'High Fives',
      'Lesson Library', 'Quiz Library', 'Insights', 'Upload',
      'CLASS', 'LIBRARY', 'INSIGHTS & TOOLS',
    ]) {
      expect(labels).toContain(l);
    }
    expect(labels.join(' ')).not.toMatch(/Homework/i);
  });

  it('matchActive: exact, prefix, and alsoActiveWhen', () => {
    expect(matchActive('/roster', '/roster')).toBe(true);
    expect(matchActive('/roster/x', '/roster')).toBe(true);
    expect(matchActive('/students/abc', '/roster', ['/students'])).toBe(true);
    expect(matchActive('/gradebook', '/roster')).toBe(false);
    // no false prefix match (/insights vs /insights-foo)
    expect(matchActive('/insights-foo', '/insights')).toBe(false);
  });
});
