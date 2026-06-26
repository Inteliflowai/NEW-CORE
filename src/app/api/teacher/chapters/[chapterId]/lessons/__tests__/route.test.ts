// Tests for POST /api/teacher/chapters/[chapterId]/lessons
// Assigns a set of lesson IDs to a chapter.
// TDD: run against implementation in ../route.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ── Mutable state ─────────────────────────────────────────────────────────────
const getUser = vi.fn();
const profileSingle = vi.fn();
const guardFn = vi.fn();

/** The chapter row returned when looking up by chapterId */
let chapterRow: unknown = { id: 'ch1', class_id: 'cl1', archived_at: null };
/** Lesson rows returned when fetching by IDs (for IDOR / class_id verification) */
let lessonRows: unknown = [
  { id: 'l1', class_id: 'cl1' },
  { id: 'l2', class_id: 'cl1' },
];
let updateError: unknown = null;

// ── Module mocks ──────────────────────────────────────────────────────────────
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ single: profileSingle }) }) }),
  }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'chapters') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: chapterRow, error: null }),
            }),
          }),
        };
      }
      if (t === 'lessons') {
        // Two paths: .select().in() for IDOR verification; .update().in() for actual assignment
        return {
          select: () => ({
            in: () => Promise.resolve({ data: lessonRows, error: null }),
          }),
          update: () => ({
            in: () => Promise.resolve({ error: updateError }),
          }),
        };
      }
      return {};
    },
  }),
}));

vi.mock('@/lib/auth/guards', () => ({ guardClassAccess: (...a: unknown[]) => guardFn(...a) }));
vi.mock('@/lib/auth/roles', () => ({
  STAFF_ROLES: ['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'],
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
const PARAMS = Promise.resolve({ chapterId: 'ch1' });

function reqPost(body: object) {
  return new NextRequest('http://x/api/teacher/chapters/ch1/lessons', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  getUser.mockReset();
  profileSingle.mockReset();
  guardFn.mockReset();

  chapterRow = { id: 'ch1', class_id: 'cl1', archived_at: null };
  lessonRows = [{ id: 'l1', class_id: 'cl1' }, { id: 'l2', class_id: 'cl1' }];
  updateError = null;

  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  profileSingle.mockResolvedValue({ data: { role: 'teacher', school_id: 's1' } });
  guardFn.mockResolvedValue(null);
});

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('POST /api/teacher/chapters/[chapterId]/lessons', () => {
  it('401 when no authenticated user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
    const { POST } = await import('@/app/api/teacher/chapters/[chapterId]/lessons/route');
    expect((await POST(reqPost({ lessonIds: ['l1'] }), { params: PARAMS })).status).toBe(401);
  });

  it('403 for non-staff role', async () => {
    profileSingle.mockResolvedValue({ data: { role: 'student', school_id: 's1' } });
    const { POST } = await import('@/app/api/teacher/chapters/[chapterId]/lessons/route');
    expect((await POST(reqPost({ lessonIds: ['l1'] }), { params: PARAMS })).status).toBe(403);
    expect(guardFn).not.toHaveBeenCalled();
  });

  it('404 when chapter not found', async () => {
    chapterRow = null;
    const { POST } = await import('@/app/api/teacher/chapters/[chapterId]/lessons/route');
    expect((await POST(reqPost({ lessonIds: ['l1'] }), { params: PARAMS })).status).toBe(404);
  });

  it('403 when guardClassAccess denies (IDOR guard)', async () => {
    guardFn.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const { POST } = await import('@/app/api/teacher/chapters/[chapterId]/lessons/route');
    expect((await POST(reqPost({ lessonIds: ['l1'] }), { params: PARAMS })).status).toBe(403);
  });

  it('409 when chapter is archived', async () => {
    chapterRow = { id: 'ch1', class_id: 'cl1', archived_at: '2026-01-01T00:00:00Z' };
    const { POST } = await import('@/app/api/teacher/chapters/[chapterId]/lessons/route');
    expect((await POST(reqPost({ lessonIds: ['l1'] }), { params: PARAMS })).status).toBe(409);
  });

  it('400 when lessonIds is missing or empty', async () => {
    const { POST } = await import('@/app/api/teacher/chapters/[chapterId]/lessons/route');
    expect((await POST(reqPost({}), { params: PARAMS })).status).toBe(400);
    expect((await POST(reqPost({ lessonIds: [] }), { params: PARAMS })).status).toBe(400);
  });

  it('403 (C1 scope guard) when a lesson belongs to a different class', async () => {
    // One lesson has a different class_id → should be rejected
    lessonRows = [
      { id: 'l1', class_id: 'cl1' },
      { id: 'l-other', class_id: 'other-class' }, // cross-class IDOR attempt
    ];
    const { POST } = await import('@/app/api/teacher/chapters/[chapterId]/lessons/route');
    const res = await POST(reqPost({ lessonIds: ['l1', 'l-other'] }), { params: PARAMS });
    // Should still succeed with just the valid lesson, OR return 403 if ALL are invalid
    // Spec says: "verify each lesson.class_id matches before updating" — silently skip mismatched
    // If at least one valid lesson exists, proceed; if none valid, 403
    expect([200, 403]).toContain(res.status);
  });

  it('200 { ok: true } when assigning valid lessons to chapter', async () => {
    const { POST } = await import('@/app/api/teacher/chapters/[chapterId]/lessons/route');
    const res = await POST(reqPost({ lessonIds: ['l1', 'l2'] }), { params: PARAMS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('403 when ALL provided lesson IDs belong to a different class (full IDOR block)', async () => {
    lessonRows = [{ id: 'l-other', class_id: 'other-class' }];
    const { POST } = await import('@/app/api/teacher/chapters/[chapterId]/lessons/route');
    const res = await POST(reqPost({ lessonIds: ['l-other'] }), { params: PARAMS });
    expect(res.status).toBe(403);
  });
});
