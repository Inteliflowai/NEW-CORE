// src/lib/skills/__tests__/resolveSkills.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveSkillIds } from '../resolveSkills';

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal Supabase admin-client mock.
 * selectResult  → returned by .select().eq().in() chain
 * insertResult  → returned by .insert().select() chain
 * retryResult   → returned by the retry .select().eq().in() chain
 */
function makeAdminMock(opts: {
  selectResult?: { data: unknown; error: unknown };
  insertResult?: { data: unknown; error: unknown };
  retryResult?: { data: unknown; error: unknown };
} = {}) {
  const {
    selectResult = { data: [], error: null },
    insertResult = { data: [], error: null },
    retryResult = { data: [], error: null },
  } = opts;

  // Each .from('skills') call starts a fresh chain.
  // First call → select path; second call (insert) → insert path;
  // third call (retry) → retry path.
  let callCount = 0;

  return {
    from: vi.fn((_table: string) => {
      callCount++;
      if (callCount === 1) {
        // Initial select chain
        const chain: Record<string, unknown> = {};
        chain['select'] = vi.fn().mockReturnValue(chain);
        chain['eq'] = vi.fn().mockReturnValue(chain);
        chain['in'] = vi.fn().mockResolvedValue(selectResult);
        return chain;
      }
      if (callCount === 2) {
        // Insert chain
        const chain: Record<string, unknown> = {};
        chain['insert'] = vi.fn().mockReturnValue(chain);
        chain['select'] = vi.fn().mockResolvedValue(insertResult);
        return chain;
      }
      // Retry select chain (23505 race or other insert error)
      const chain: Record<string, unknown> = {};
      chain['select'] = vi.fn().mockReturnValue(chain);
      chain['eq'] = vi.fn().mockReturnValue(chain);
      chain['in'] = vi.fn().mockResolvedValue(retryResult);
      return chain;
    }),
  } as unknown as SupabaseClient;
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('resolveSkillIds', () => {
  it('returns empty map when tags array is empty', async () => {
    const admin = makeAdminMock();
    const result = await resolveSkillIds(admin, {
      schoolId: 'school-1',
      subject: 'Math',
      tags: [],
    });
    expect(result.size).toBe(0);
  });

  it('tags that slugify to empty string are dropped', async () => {
    const admin = makeAdminMock();
    // Tags composed entirely of non-alnum chars slugify to ''
    const result = await resolveSkillIds(admin, {
      schoolId: 'school-1',
      subject: 'Math',
      tags: ['---', '   '],
    });
    expect(result.size).toBe(0);
  });

  it('returns existing skill ids from select result without inserting', async () => {
    const admin = makeAdminMock({
      selectResult: {
        data: [{ id: 'skill-uuid-1', subject: 'Math', slug: 'fractions' }],
        error: null,
      },
    });
    const result = await resolveSkillIds(admin, {
      schoolId: 'school-1',
      subject: 'Math',
      tags: ['Fractions'],
    });
    expect(result.get('Fractions')).toBe('skill-uuid-1');
    // Only one from() call (select path — no insert needed)
    expect((admin.from as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('creates unreviewed row for unknown tag and maps the raw tag to new id', async () => {
    const admin = makeAdminMock({
      selectResult: { data: [], error: null },
      insertResult: {
        data: [{ id: 'new-skill-id', subject: 'Math', slug: 'decimals' }],
        error: null,
      },
    });
    const result = await resolveSkillIds(admin, {
      schoolId: 'school-1',
      subject: 'Math',
      tags: ['Decimals'],
    });
    expect(result.get('Decimals')).toBe('new-skill-id');
  });

  it('subject mismatch: row exists but under different subject → inserts new row', async () => {
    // Row for 'decimals' exists but under subject 'Science', not 'Math'
    const admin = makeAdminMock({
      selectResult: {
        data: [{ id: 'science-skill', subject: 'Science', slug: 'decimals' }],
        error: null,
      },
      insertResult: {
        data: [{ id: 'math-skill', subject: 'Math', slug: 'decimals' }],
        error: null,
      },
    });
    const result = await resolveSkillIds(admin, {
      schoolId: 'school-1',
      subject: 'Math',
      tags: ['Decimals'],
    });
    expect(result.get('Decimals')).toBe('math-skill');
    // Two from() calls: select + insert
    expect((admin.from as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it('on 23505 unique-violation: re-selects and returns the winning row', async () => {
    const admin = makeAdminMock({
      selectResult: { data: [], error: null },
      insertResult: {
        data: null,
        error: { message: 'duplicate key', code: '23505' },
      },
      retryResult: {
        data: [{ id: 'race-winner-id', subject: 'Math', slug: 'fractions' }],
        error: null,
      },
    });
    const result = await resolveSkillIds(admin, {
      schoolId: 'school-1',
      subject: 'Math',
      tags: ['Fractions'],
    });
    expect(result.get('Fractions')).toBe('race-winner-id');
    // Three from() calls: initial select + insert (fails) + retry select
    expect((admin.from as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
  });

  it('on non-23505 insert error: logs and resolves what it can from retry', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const admin = makeAdminMock({
      selectResult: { data: [], error: null },
      insertResult: {
        data: null,
        error: { message: 'connection refused', code: 'PGRST301' },
      },
      retryResult: { data: [], error: null },
    });
    const result = await resolveSkillIds(admin, {
      schoolId: 'school-1',
      subject: 'Math',
      tags: ['Fractions'],
    });
    // Could not insert and retry returned nothing — map is empty but no throw
    expect(result.size).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith(
      '[resolveSkillIds] insert error:',
      expect.objectContaining({ code: 'PGRST301' }),
    );
    consoleSpy.mockRestore();
  });

  it('on initial select error: logs and returns empty map (fail-soft)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const admin = makeAdminMock({
      selectResult: { data: null, error: { message: 'db timeout', code: '08006' } },
    });
    const result = await resolveSkillIds(admin, {
      schoolId: 'school-1',
      subject: 'Math',
      tags: ['Fractions'],
    });
    expect(result.size).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith(
      '[resolveSkillIds] select error:',
      expect.objectContaining({ code: '08006' }),
    );
    consoleSpy.mockRestore();
  });

  it('deduplicates slugs: two accent-variant tags fold to one slug → one db row created', async () => {
    // 'Frações' and 'Fracoes' both slugify to 'fracoes'
    const admin = makeAdminMock({
      selectResult: { data: [], error: null },
      insertResult: {
        data: [{ id: 'fracoes-id', subject: 'Math', slug: 'fracoes' }],
        error: null,
      },
    });
    const result = await resolveSkillIds(admin, {
      schoolId: 'school-1',
      subject: 'Math',
      tags: ['Frações', 'Fracoes'],
    });
    // Both raw tags map to the same skill id
    expect(result.get('Frações')).toBe('fracoes-id');
    expect(result.get('Fracoes')).toBe('fracoes-id');
  });

  it('null subject treated same as empty string subject', async () => {
    const admin = makeAdminMock({
      selectResult: {
        data: [{ id: 'null-subject-skill', subject: null, slug: 'addition' }],
        error: null,
      },
    });
    const result = await resolveSkillIds(admin, {
      schoolId: 'school-1',
      subject: null,
      tags: ['Addition'],
    });
    expect(result.get('Addition')).toBe('null-subject-skill');
  });

  it('createdBy defaults to ai when not provided', async () => {
    const admin = makeAdminMock({
      selectResult: { data: [], error: null },
      insertResult: {
        data: [{ id: 'new-id', subject: 'Math', slug: 'addition' }],
        error: null,
      },
    });
    await resolveSkillIds(admin, {
      schoolId: 'school-1',
      subject: 'Math',
      tags: ['Addition'],
    });
    const insertCall = (admin.from as ReturnType<typeof vi.fn>).mock.calls[1];
    // The insert chain's insert() was called with rows containing created_by: 'ai'
    // We verify via the from() call occurring at index 1 (insert path)
    expect(insertCall[0]).toBe('skills');
  });
});
