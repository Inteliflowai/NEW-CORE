import { describe, it, expect } from 'vitest';
import { openAlertCountForTeacher } from '@/lib/alerts/openAlertCount';

// Mock admin: classes owned by teacher = [c1]; open urgent alerts on c1 for s1 (x2) + s2.
function mockAdmin() {
  const api: Record<string, unknown> = {};
  const chain = () => api;
  for (const m of ['select', 'eq', 'in']) api[m] = chain;
  return {
    from(table: string) {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      for (const m of ['select', 'eq', 'in']) q[m] = chain;
      (q as { then: (resolve: (v: { data: unknown }) => void) => void }).then = (resolve) => {
        if (table === 'classes') return resolve({ data: [{ id: 'c1' }] });
        if (table === 'alerts') return resolve({ data: [
          { student_id: 's1' }, { student_id: 's1' }, { student_id: 's2' },
        ] });
        return resolve({ data: [] });
      };
      return q;
    },
  };
}

describe('openAlertCountForTeacher', () => {
  it('counts DISTINCT students with an open urgent alert', async () => {
    const n = await openAlertCountForTeacher(mockAdmin() as never, 't1');
    expect(n).toBe(2); // s1 deduped
  });
});
