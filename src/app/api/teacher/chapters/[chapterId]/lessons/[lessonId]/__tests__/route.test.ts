// Tests for DELETE /api/teacher/chapters/[chapterId]/lessons/[lessonId]
// Unassigns a lesson from a chapter (sets chapter_id = null).
// TDD: run against implementation in ../route.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ── Mutable state ─────────────────────────────────────────────────────────────
const getUser = vi.fn();
const profileSingle = vi.fn();
const guardFn = vi.fn();

let chapterRow: unknown = { id: 'ch1', class_id: 'cl1', archived_at: null };
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
        // DELETE unassign: update({ chapter_id: null }).eq('id', lessonId).eq('class_id', ...)
        return {
          update: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ error: updateError }),
            }),
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
const PARAMS = Promise.resolve({ chapterId: 'ch1', lessonId: 'l1' });

function reqDelete() {
  return new NextRequest('http://x/api/teacher/chapters/ch1/lessons/l1', { method: 'DELETE' });
}

beforeEach(() => {
  getUser.mockReset();
  profileSingle.mockReset();
  guardFn.mockReset();

  chapterRow = { id: 'ch1', class_id: 'cl1', archived_at: null };
  updateError = null;

  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  profileSingle.mockResolvedValue({ data: { role: 'teacher', school_id: 's1' } });
  guardFn.mockResolvedValue(null);
});

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('DELETE /api/teacher/chapters/[chapterId]/lessons/[lessonId]', () => {
  it('401 when no authenticated user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
    const { DELETE } = await import('@/app/api/teacher/chapters/[chapterId]/lessons/[lessonId]/route');
    expect((await DELETE(reqDelete(), { params: PARAMS })).status).toBe(401);
  });

  it('403 for non-staff role', async () => {
    profileSingle.mockResolvedValue({ data: { role: 'student', school_id: 's1' } });
    const { DELETE } = await import('@/app/api/teacher/chapters/[chapterId]/lessons/[lessonId]/route');
    expect((await DELETE(reqDelete(), { params: PARAMS })).status).toBe(403);
    expect(guardFn).not.toHaveBeenCalled();
  });

  it('404 when chapter not found', async () => {
    chapterRow = null;
    const { DELETE } = await import('@/app/api/teacher/chapters/[chapterId]/lessons/[lessonId]/route');
    expect((await DELETE(reqDelete(), { params: PARAMS })).status).toBe(404);
  });

  it('403 when guardClassAccess denies (cross-teacher IDOR)', async () => {
    guardFn.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const { DELETE } = await import('@/app/api/teacher/chapters/[chapterId]/lessons/[lessonId]/route');
    expect((await DELETE(reqDelete(), { params: PARAMS })).status).toBe(403);
  });

  it('200 { ok: true } — sets chapter_id = null on the lesson', async () => {
    const { DELETE } = await import('@/app/api/teacher/chapters/[chapterId]/lessons/[lessonId]/route');
    const res = await DELETE(reqDelete(), { params: PARAMS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('500 when DB update fails', async () => {
    updateError = { message: 'DB error' };
    const { DELETE } = await import('@/app/api/teacher/chapters/[chapterId]/lessons/[lessonId]/route');
    const res = await DELETE(reqDelete(), { params: PARAMS });
    expect(res.status).toBe(500);
  });
});
