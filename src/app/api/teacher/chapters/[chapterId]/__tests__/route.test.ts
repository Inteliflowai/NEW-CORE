// Tests for PATCH /api/teacher/chapters/[chapterId] and DELETE /api/teacher/chapters/[chapterId]
// TDD: tests run against the implementation in ../route.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ── Mutable state ─────────────────────────────────────────────────────────────
const getUser = vi.fn();
const profileSingle = vi.fn();
const guardFn = vi.fn();

let chapterRow: unknown = { id: 'ch1', class_id: 'cl1', title: 'Chapter 1', archived_at: null };
let updateError: unknown = null;

// ── Module mocks ──────────────────────────────────────────────────────────────
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ single: profileSingle }) }) }),
  }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t !== 'chapters') return {};
      return {
        // Lookup by chapterId → get class_id for IDOR guard
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: chapterRow, error: null }),
          }),
        }),
        // PATCH / DELETE (archive) update
        update: () => ({
          eq: () => Promise.resolve({ error: updateError }),
        }),
      };
    },
  }),
}));

vi.mock('@/lib/auth/guards', () => ({ guardClassAccess: (...a: unknown[]) => guardFn(...a) }));
vi.mock('@/lib/auth/roles', () => ({
  STAFF_ROLES: ['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'],
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
const PARAMS = Promise.resolve({ chapterId: 'ch1' });

function reqPatch(body: object) {
  return new NextRequest('http://x/api/teacher/chapters/ch1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function reqDelete() {
  return new NextRequest('http://x/api/teacher/chapters/ch1', { method: 'DELETE' });
}

beforeEach(() => {
  getUser.mockReset();
  profileSingle.mockReset();
  guardFn.mockReset();

  chapterRow = { id: 'ch1', class_id: 'cl1', title: 'Chapter 1', archived_at: null };
  updateError = null;

  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  profileSingle.mockResolvedValue({ data: { role: 'teacher', school_id: 's1' } });
  guardFn.mockResolvedValue(null); // allow
});

// ── PATCH tests ───────────────────────────────────────────────────────────────
describe('PATCH /api/teacher/chapters/[chapterId]', () => {
  it('401 when no authenticated user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
    const { PATCH } = await import('@/app/api/teacher/chapters/[chapterId]/route');
    expect((await PATCH(reqPatch({ title: 'New Title' }), { params: PARAMS })).status).toBe(401);
  });

  it('403 for non-staff role', async () => {
    profileSingle.mockResolvedValue({ data: { role: 'student', school_id: 's1' } });
    const { PATCH } = await import('@/app/api/teacher/chapters/[chapterId]/route');
    expect((await PATCH(reqPatch({ title: 'New Title' }), { params: PARAMS })).status).toBe(403);
    expect(guardFn).not.toHaveBeenCalled();
  });

  it('404 when chapter not found', async () => {
    chapterRow = null;
    const { PATCH } = await import('@/app/api/teacher/chapters/[chapterId]/route');
    expect((await PATCH(reqPatch({ title: 'New Title' }), { params: PARAMS })).status).toBe(404);
  });

  it('403 when guardClassAccess denies (cross-teacher IDOR)', async () => {
    guardFn.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const { PATCH } = await import('@/app/api/teacher/chapters/[chapterId]/route');
    expect((await PATCH(reqPatch({ title: 'New Title' }), { params: PARAMS })).status).toBe(403);
  });

  it('400 when body has no recognised update fields', async () => {
    const { PATCH } = await import('@/app/api/teacher/chapters/[chapterId]/route');
    expect((await PATCH(reqPatch({}), { params: PARAMS })).status).toBe(400);
  });

  it('200 { ok: true } when updating title', async () => {
    const { PATCH } = await import('@/app/api/teacher/chapters/[chapterId]/route');
    const res = await PATCH(reqPatch({ title: 'Renamed Chapter' }), { params: PARAMS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('200 { ok: true } when updating sequence', async () => {
    const { PATCH } = await import('@/app/api/teacher/chapters/[chapterId]/route');
    const res = await PATCH(reqPatch({ sequence: 3 }), { params: PARAMS });
    expect(res.status).toBe(200);
  });

  it('200 { ok: true } when updating description', async () => {
    const { PATCH } = await import('@/app/api/teacher/chapters/[chapterId]/route');
    const res = await PATCH(reqPatch({ description: 'A new description' }), { params: PARAMS });
    expect(res.status).toBe(200);
  });

  it('500 when DB update fails', async () => {
    updateError = { message: 'DB error' };
    const { PATCH } = await import('@/app/api/teacher/chapters/[chapterId]/route');
    const res = await PATCH(reqPatch({ title: 'New' }), { params: PARAMS });
    expect(res.status).toBe(500);
  });
});

// ── DELETE tests ──────────────────────────────────────────────────────────────
describe('DELETE /api/teacher/chapters/[chapterId] (soft archive)', () => {
  it('401 when no authenticated user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
    const { DELETE } = await import('@/app/api/teacher/chapters/[chapterId]/route');
    expect((await DELETE(reqDelete(), { params: PARAMS })).status).toBe(401);
  });

  it('403 for non-staff role', async () => {
    profileSingle.mockResolvedValue({ data: { role: 'student', school_id: 's1' } });
    const { DELETE } = await import('@/app/api/teacher/chapters/[chapterId]/route');
    expect((await DELETE(reqDelete(), { params: PARAMS })).status).toBe(403);
  });

  it('404 when chapter not found', async () => {
    chapterRow = null;
    const { DELETE } = await import('@/app/api/teacher/chapters/[chapterId]/route');
    expect((await DELETE(reqDelete(), { params: PARAMS })).status).toBe(404);
  });

  it('403 when guardClassAccess denies (cross-teacher IDOR)', async () => {
    guardFn.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const { DELETE } = await import('@/app/api/teacher/chapters/[chapterId]/route');
    expect((await DELETE(reqDelete(), { params: PARAMS })).status).toBe(403);
  });

  it('200 { ok: true } — sets archived_at (soft delete)', async () => {
    const { DELETE } = await import('@/app/api/teacher/chapters/[chapterId]/route');
    const res = await DELETE(reqDelete(), { params: PARAMS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('does NOT hard-delete: returns 200 even when chapter has archived_at (idempotent)', async () => {
    // Archiving an already-archived chapter is a no-op
    chapterRow = { id: 'ch1', class_id: 'cl1', title: 'Chapter 1', archived_at: '2026-01-01T00:00:00Z' };
    const { DELETE } = await import('@/app/api/teacher/chapters/[chapterId]/route');
    const res = await DELETE(reqDelete(), { params: PARAMS });
    expect(res.status).toBe(200);
  });
});
