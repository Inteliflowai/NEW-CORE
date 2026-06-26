// Tests for GET /api/teacher/chapters and POST /api/teacher/chapters
// TDD: these run against the implementation in ../route.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ── Mutable state (read by factory closures at call-time) ─────────────────────
const getUser = vi.fn();
const profileSingle = vi.fn();
const guardFn = vi.fn();

let chaptersListData: unknown = [];
let chaptersListError: unknown = null;
let lessonsData: unknown = [];
let insertData: unknown = null;
let insertError: unknown = null;

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
          // GET list query: .select().eq('class_id').is('archived_at', null).order()
          select: () => ({
            eq: () => ({
              is: () => ({
                order: () => Promise.resolve({ data: chaptersListData, error: chaptersListError }),
              }),
            }),
          }),
          // POST create query: .insert().select('id').single()
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: insertData, error: insertError }),
            }),
          }),
        };
      }
      if (t === 'lessons') {
        // Lesson count query for GET: .select('chapter_id').in('chapter_id', ids)
        return {
          select: () => ({
            in: () => Promise.resolve({ data: lessonsData, error: null }),
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
function reqGet(classId?: string) {
  const url = classId
    ? `http://x/api/teacher/chapters?classId=${encodeURIComponent(classId)}`
    : 'http://x/api/teacher/chapters';
  return new NextRequest(url);
}

function reqPost(body: object) {
  return new NextRequest('http://x/api/teacher/chapters', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  getUser.mockReset();
  profileSingle.mockReset();
  guardFn.mockReset();

  chaptersListData = [];
  chaptersListError = null;
  lessonsData = [];
  insertData = { id: 'ch-new' };
  insertError = null;

  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  profileSingle.mockResolvedValue({ data: { role: 'teacher', school_id: 's1' } });
  guardFn.mockResolvedValue(null); // allow
});

// ── GET tests ─────────────────────────────────────────────────────────────────
describe('GET /api/teacher/chapters', () => {
  it('401 when no authenticated user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
    const { GET } = await import('@/app/api/teacher/chapters/route');
    expect((await GET(reqGet('cl1'))).status).toBe(401);
  });

  it('403 for non-staff role (student)', async () => {
    profileSingle.mockResolvedValue({ data: { role: 'student', school_id: 's1' } });
    const { GET } = await import('@/app/api/teacher/chapters/route');
    expect((await GET(reqGet('cl1'))).status).toBe(403);
    expect(guardFn).not.toHaveBeenCalled();
  });

  it('400 when classId query param is missing', async () => {
    const { GET } = await import('@/app/api/teacher/chapters/route');
    expect((await GET(reqGet())).status).toBe(400);
  });

  it('403 when guardClassAccess denies (IDOR)', async () => {
    guardFn.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const { GET } = await import('@/app/api/teacher/chapters/route');
    expect((await GET(reqGet('cl1'))).status).toBe(403);
  });

  it('returns { chapters: [] } when no chapters exist', async () => {
    chaptersListData = [];
    const { GET } = await import('@/app/api/teacher/chapters/route');
    const res = await GET(reqGet('cl1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chapters).toEqual([]);
  });

  it('returns chapters list with lesson_count', async () => {
    chaptersListData = [
      { id: 'ch1', class_id: 'cl1', title: 'Chapter 1', description: null, sequence: 1, created_at: '2026-01-01T00:00:00Z', archived_at: null },
      { id: 'ch2', class_id: 'cl1', title: 'Chapter 2', description: null, sequence: 2, created_at: '2026-01-02T00:00:00Z', archived_at: null },
    ];
    lessonsData = [
      { chapter_id: 'ch1' },
      { chapter_id: 'ch1' },
      { chapter_id: 'ch2' },
    ];
    const { GET } = await import('@/app/api/teacher/chapters/route');
    const res = await GET(reqGet('cl1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chapters).toHaveLength(2);
    expect(body.chapters.find((c: { id: string }) => c.id === 'ch1').lesson_count).toBe(2);
    expect(body.chapters.find((c: { id: string }) => c.id === 'ch2').lesson_count).toBe(1);
  });

  it('lesson_count is 0 when no lessons assigned', async () => {
    chaptersListData = [
      { id: 'ch1', class_id: 'cl1', title: 'Chapter 1', description: null, sequence: 1, created_at: '2026-01-01T00:00:00Z', archived_at: null },
    ];
    lessonsData = [];
    const { GET } = await import('@/app/api/teacher/chapters/route');
    const res = await GET(reqGet('cl1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chapters[0].lesson_count).toBe(0);
  });

  it('returns 200 with chapters:[] when no chapters (no lesson count query needed)', async () => {
    chaptersListData = [];
    const { GET } = await import('@/app/api/teacher/chapters/route');
    const res = await GET(reqGet('cl1'));
    expect(res.status).toBe(200);
    expect((await res.json()).chapters).toEqual([]);
  });
});

// ── POST tests ────────────────────────────────────────────────────────────────
describe('POST /api/teacher/chapters', () => {
  it('401 when no authenticated user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
    const { POST } = await import('@/app/api/teacher/chapters/route');
    expect((await POST(reqPost({ classId: 'cl1', title: 'Ch 1' }))).status).toBe(401);
  });

  it('403 for non-staff role (student)', async () => {
    profileSingle.mockResolvedValue({ data: { role: 'student', school_id: 's1' } });
    const { POST } = await import('@/app/api/teacher/chapters/route');
    expect((await POST(reqPost({ classId: 'cl1', title: 'Ch 1' }))).status).toBe(403);
    expect(guardFn).not.toHaveBeenCalled();
  });

  it('400 when classId is missing', async () => {
    const { POST } = await import('@/app/api/teacher/chapters/route');
    expect((await POST(reqPost({ title: 'Ch 1' }))).status).toBe(400);
  });

  it('400 when title is missing', async () => {
    const { POST } = await import('@/app/api/teacher/chapters/route');
    expect((await POST(reqPost({ classId: 'cl1' }))).status).toBe(400);
  });

  it('400 when title is blank (whitespace)', async () => {
    const { POST } = await import('@/app/api/teacher/chapters/route');
    expect((await POST(reqPost({ classId: 'cl1', title: '   ' }))).status).toBe(400);
  });

  it('403 when guardClassAccess denies (cross-class IDOR)', async () => {
    guardFn.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const { POST } = await import('@/app/api/teacher/chapters/route');
    expect((await POST(reqPost({ classId: 'cl1', title: 'Ch 1' }))).status).toBe(403);
  });

  it('201 + { chapter_id } on success', async () => {
    insertData = { id: 'ch-new-1' };
    const { POST } = await import('@/app/api/teacher/chapters/route');
    const res = await POST(reqPost({ classId: 'cl1', title: 'Chapter 1', description: 'A good chapter', sequence: 3 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.chapter_id).toBe('ch-new-1');
  });

  it('500 when insert returns an error', async () => {
    insertData = null;
    insertError = { message: 'DB error' };
    const { POST } = await import('@/app/api/teacher/chapters/route');
    const res = await POST(reqPost({ classId: 'cl1', title: 'Ch 1' }));
    expect(res.status).toBe(500);
  });
});
