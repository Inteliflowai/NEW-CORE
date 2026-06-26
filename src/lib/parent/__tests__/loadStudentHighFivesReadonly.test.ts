import { describe, it, expect } from 'vitest';
import { loadStudentHighFivesReadonly } from '@/lib/parent/loadStudentHighFivesReadonly';
import type { SupabaseClient } from '@supabase/supabase-js';

type Resolve = (v: { data: unknown[]; error: null }) => void;

function makeChain(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ['select', 'eq', 'order', 'limit']) q[m] = chain;
  (q as { then: (r: Resolve) => void }).then = (resolve) => resolve({ data: rows, error: null });
  return q;
}

describe('loadStudentHighFivesReadonly', () => {
  it('returns clean notes with the `note` field (not note_text)', async () => {
    const rows = [
      { id: 'hf1', note_text: 'You worked really hard on this.', created_at: '2026-06-22T10:00:00Z' },
      { id: 'hf2', note_text: 'Great effort today!', created_at: '2026-06-20T10:00:00Z' },
    ];
    let updateCalled = false;
    const admin = {
      from(_table: string) {
        const q = makeChain(rows);
        (q as Record<string, unknown>).update = () => { updateCalled = true; return makeChain([]); };
        return q;
      },
    } as unknown as SupabaseClient;

    const result = await loadStudentHighFivesReadonly(admin, 'student1');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 'hf1', note: 'You worked really hard on this.', created_at: '2026-06-22T10:00:00Z' });
    expect(result[1]).toEqual({ id: 'hf2', note: 'Great effort today!', created_at: '2026-06-20T10:00:00Z' });
    expect(Object.keys(result[0])).toEqual(['id', 'note', 'created_at']);
    expect(updateCalled).toBe(false);
  });

  it('drops notes that contain a parent-unsafe phrase (C1 filter)', async () => {
    const rows = [
      { id: 'hf1', note_text: 'You worked really hard on this.', created_at: '2026-06-22T10:00:00Z' },
      // "on track" and "falling behind" are PARENT_FORBIDDEN — must be dropped
      { id: 'hf2', note_text: "Glad you're back on track after falling behind!", created_at: '2026-06-21T10:00:00Z' },
      // "reinforce" is PARENT_FORBIDDEN — must be dropped
      { id: 'hf3', note_text: 'We will reinforce this skill next week.', created_at: '2026-06-20T10:00:00Z' },
    ];
    const admin = {
      from(_table: string) { return makeChain(rows); },
    } as unknown as SupabaseClient;

    const result = await loadStudentHighFivesReadonly(admin, 'student1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('hf1');
  });

  it('does NOT call .update on the admin client (no viewed_by_student_at stamp)', async () => {
    const rows = [
      { id: 'hf1', note_text: 'Amazing focus today.', created_at: '2026-06-22T10:00:00Z' },
    ];
    let updateCalled = false;
    const admin = {
      from(_table: string) {
        const q = makeChain(rows);
        (q as Record<string, unknown>).update = () => {
          updateCalled = true;
          return makeChain([]);
        };
        return q;
      },
    } as unknown as SupabaseClient;

    await loadStudentHighFivesReadonly(admin, 'student1');
    expect(updateCalled).toBe(false);
  });

  it('returns empty array when there are no notes', async () => {
    const admin = {
      from(_table: string) { return makeChain([]); },
    } as unknown as SupabaseClient;
    const result = await loadStudentHighFivesReadonly(admin, 'student1');
    expect(result).toEqual([]);
  });

  it('returns empty array when ALL notes are filtered by the parent guard', async () => {
    const rows = [
      { id: 'hf1', note_text: 'Student is at risk of falling behind peers.', created_at: '2026-06-22T10:00:00Z' },
    ];
    const admin = {
      from(_table: string) { return makeChain(rows); },
    } as unknown as SupabaseClient;
    const result = await loadStudentHighFivesReadonly(admin, 'student1');
    expect(result).toEqual([]);
  });

  it('respects the limit parameter', async () => {
    const rows = [
      { id: 'hf1', note_text: 'Great work!', created_at: '2026-06-22T10:00:00Z' },
    ];
    let capturedLimit: unknown;
    const admin = {
      from(_table: string) {
        const q: Record<string, unknown> = {};
        const chain = () => q;
        for (const m of ['select', 'eq', 'order']) q[m] = chain;
        q.limit = (n: unknown) => { capturedLimit = n; return q; };
        (q as { then: (r: Resolve) => void }).then = (resolve) => resolve({ data: rows, error: null });
        return q;
      },
    } as unknown as SupabaseClient;

    await loadStudentHighFivesReadonly(admin, 'student1', 3);
    expect(capturedLimit).toBe(3);
  });
});
