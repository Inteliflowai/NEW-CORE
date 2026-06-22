import { describe, it, expect } from 'vitest';
import { loadStudentHighFives } from '@/lib/highfives/loadStudentHighFives';

// Minimal chainable query stub that mirrors the loadGradebook harness.
// Table-specific rows are returned via the thenable.
type Resolve = (v: { data: unknown[]; error: null }) => void;

function makeTable(rows: unknown[], extraMethods: Record<string, (v: unknown) => unknown> = {}) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) q[m] = chain;
  // Allow `update` + `in` chaining for the viewed_by_student_at stamp
  Object.assign(q, extraMethods);
  (q as { then: (r: Resolve) => void }).then = (resolve) => resolve({ data: rows, error: null });
  return q;
}

describe('loadStudentHighFives', () => {
  it('returns the student notes newest-first with the requested limit', async () => {
    const rows = [
      { id: 'hf1', note_text: 'You kept at it.', created_at: '2026-06-22T10:00:00Z', viewed_by_student_at: null },
      { id: 'hf2', note_text: 'Great thinking.', created_at: '2026-06-20T10:00:00Z', viewed_by_student_at: '2026-06-20T11:00:00Z' },
    ];

    let updateCalled = false;
    let updatedIds: string[] = [];

    // Build a chainable update stub that captures which IDs are stamped
    function makeUpdateChain(ids: string[]) {
      updatedIds = ids;
      updateCalled = true;
      const uq: Record<string, unknown> = {};
      const chain = () => uq;
      for (const m of ['update', 'in', 'eq', 'select']) uq[m] = chain;
      (uq as { then: (r: Resolve) => void }).then = (resolve) => resolve({ data: [], error: null });
      return uq;
    }

    // Admin mock: returns rows on select, captures update calls
    let callCount = 0;
    const admin = {
      from(table: string) {
        if (table === 'high_fives') {
          callCount += 1;
          if (callCount === 1) {
            // First call: the SELECT query
            return makeTable(rows);
          }
          // Second call: the UPDATE query for unviewed rows
          const q: Record<string, unknown> = {};
          q.update = (payload: unknown) => {
            void payload;
            const innerQ: Record<string, unknown> = {};
            innerQ.in = (col: unknown, ids: string[]) => {
              void col;
              updatedIds = ids;
              updateCalled = true;
              const r: Record<string, unknown> = {};
              (r as { then: (resolve: Resolve) => void }).then = (resolve) => resolve({ data: [], error: null });
              return r;
            };
            return innerQ;
          };
          (q as { then: (r: Resolve) => void }).then = (resolve) => resolve({ data: rows, error: null });
          // also expose select/eq/order/limit to handle the chain
          const chain = () => q;
          for (const m of ['select', 'eq', 'order', 'limit']) q[m] = chain;
          return q;
        }
        return makeTable([]);
      },
    } as unknown as Parameters<typeof loadStudentHighFives>[0];

    const result = await loadStudentHighFives(admin, 'student1', 2);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('hf1');
    expect(result[0].note_text).toBe('You kept at it.');
    expect(result[1].id).toBe('hf2');
    // The result should NOT include viewed_by_student_at (mapped out)
    expect(Object.keys(result[0])).toEqual(['id', 'note_text', 'created_at']);
  });

  it('stamps viewed_by_student_at for unviewed notes', async () => {
    const rows = [
      { id: 'hf1', note_text: 'You kept at it.', created_at: '2026-06-22T10:00:00Z', viewed_by_student_at: null },
      { id: 'hf2', note_text: 'Nice effort.', created_at: '2026-06-21T10:00:00Z', viewed_by_student_at: null },
    ];

    let updateCalledWithIds: string[] = [];

    const admin = {
      from(table: string) {
        if (table === 'high_fives') {
          const q: Record<string, unknown> = {};
          const chain = () => q;
          for (const m of ['select', 'eq', 'order', 'limit']) q[m] = chain;

          q.update = (_payload: unknown) => {
            const innerQ: Record<string, unknown> = {};
            innerQ.in = (_col: unknown, ids: string[]) => {
              updateCalledWithIds = ids;
              const r: Record<string, unknown> = {};
              (r as { then: (resolve: Resolve) => void }).then = (resolve) => resolve({ data: [], error: null });
              return r;
            };
            return innerQ;
          };

          (q as { then: (resolve: Resolve) => void }).then = (resolve) => resolve({ data: rows, error: null });
          return q;
        }
        return makeTable([]);
      },
    } as unknown as Parameters<typeof loadStudentHighFives>[0];

    await loadStudentHighFives(admin, 'student1', 2);

    expect(updateCalledWithIds.sort()).toEqual(['hf1', 'hf2']);
  });

  it('does not call update when all notes are already viewed', async () => {
    const rows = [
      { id: 'hf1', note_text: 'You kept at it.', created_at: '2026-06-22T10:00:00Z', viewed_by_student_at: '2026-06-22T11:00:00Z' },
    ];

    let updateCalled = false;

    const admin = {
      from(table: string) {
        if (table === 'high_fives') {
          const q: Record<string, unknown> = {};
          const chain = () => q;
          for (const m of ['select', 'eq', 'order', 'limit']) q[m] = chain;
          q.update = () => { updateCalled = true; return makeTable([]); };
          (q as { then: (resolve: Resolve) => void }).then = (resolve) => resolve({ data: rows, error: null });
          return q;
        }
        return makeTable([]);
      },
    } as unknown as Parameters<typeof loadStudentHighFives>[0];

    const result = await loadStudentHighFives(admin, 'student1');
    expect(result).toHaveLength(1);
    expect(updateCalled).toBe(false);
  });

  it('returns empty array when there are no notes', async () => {
    const admin = {
      from(_table: string) {
        return makeTable([]);
      },
    } as unknown as Parameters<typeof loadStudentHighFives>[0];

    const result = await loadStudentHighFives(admin, 'student1');
    expect(result).toHaveLength(0);
  });
});
