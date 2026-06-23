// src/app/api/attempts/drawing/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const guardStudentAccess = vi.fn();
const uploads: Array<{ path: string }> = [];
const downloads: string[] = [];
let ATTEMPT: unknown; let ROLE: string; let DOWNLOAD: { data: Blob | null; error: unknown };

vi.mock('@/lib/auth/roles', () => ({ STAFF_ROLES: ['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'] as const }));
vi.mock('@/lib/auth/guards', () => ({ guardStudentAccess }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'users') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: ROLE } }) }) }) };
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ATTEMPT }) }) }) }) };
    },
    storage: { from: () => ({
      upload: async (path: string) => { uploads.push({ path }); return { data: { path }, error: null }; },
      download: async (path: string) => { downloads.push(path); return DOWNLOAD; },
    }) },
  }),
}));

function postReq(form: FormData) { return new NextRequest('http://x/api/attempts/drawing', { method: 'POST', body: form }); }
function getReq(path: string) { return new NextRequest(`http://x/api/attempts/drawing?path=${encodeURIComponent(path)}`); }

beforeEach(() => {
  getUser.mockReset(); guardStudentAccess.mockReset(); uploads.length = 0; downloads.length = 0;
  ROLE = 'teacher'; ATTEMPT = { id: 'A1', student_id: 'stu1', status: 'in_progress' };
  DOWNLOAD = { data: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), error: null };
  getUser.mockResolvedValue({ data: { user: { id: 'stu1' } }, error: null });
  guardStudentAccess.mockResolvedValue(null);
});

function fd(over: Record<string, string | Blob> = {}) {
  const f = new FormData();
  f.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'd.png');
  f.append('attempt_id', 'A1'); f.append('step', '1');
  for (const [k, v] of Object.entries(over)) f.set(k, v);
  return f;
}

describe('POST /api/attempts/drawing', () => {
  it('401 without a user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { POST } = await import('@/app/api/attempts/drawing/route');
    expect((await POST(postReq(fd()))).status).toBe(401);
  });
  it('404 when the attempt is not the caller\'s in_progress row', async () => {
    ATTEMPT = null;
    const { POST } = await import('@/app/api/attempts/drawing/route');
    expect((await POST(postReq(fd()))).status).toBe(404);
  });
  it('uploads under {student}/{attempt}/… and returns a proxy image_url', async () => {
    const { POST } = await import('@/app/api/attempts/drawing/route');
    const res = await POST(postReq(fd()));
    expect(res.status).toBe(200);
    expect(uploads[0].path).toMatch(/^stu1\/A1\/task-1-\d+\.png$/);
    const body = await res.json();
    expect(body.image_url).toBe(`/api/attempts/drawing?path=${encodeURIComponent(uploads[0].path)}`);
  });
  it('415 on a non-image file', async () => {
    const { POST } = await import('@/app/api/attempts/drawing/route');
    expect((await POST(postReq(fd({ file: new Blob(['x'], { type: 'application/pdf' }) })))).status).toBe(415);
  });
  it('413 and NO upload on an oversize image (> 8 MB)', async () => {
    // Real byte length > 8 MB so the size survives the FormData round-trip in req.formData().
    const big = new Blob([new Uint8Array(9 * 1024 * 1024)], { type: 'image/png' });
    const { POST } = await import('@/app/api/attempts/drawing/route');
    expect((await POST(postReq(fd({ file: big })))).status).toBe(413);
    expect(uploads).toHaveLength(0);
  });
  it('400 on a non-digit step', async () => {
    const { POST } = await import('@/app/api/attempts/drawing/route');
    expect((await POST(postReq(fd({ step: 'abc' })))).status).toBe(400);
    expect(uploads).toHaveLength(0);
  });
});

describe('GET /api/attempts/drawing', () => {
  it('serves bytes to the student who owns the path', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'stu1' } }, error: null });
    const { GET } = await import('@/app/api/attempts/drawing/route');
    const res = await GET(getReq('stu1/A1/task-1-1.png'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/image\/png/);
  });
  it('lets a staff member with access view another student\'s drawing', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'teacher1' } }, error: null }); ROLE = 'teacher';
    const { GET } = await import('@/app/api/attempts/drawing/route');
    expect((await GET(getReq('stu1/A1/task-1-1.png'))).status).toBe(200);
    expect(guardStudentAccess).toHaveBeenCalledWith('stu1');
  });
  it('403 for a non-staff non-owner', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'other' } }, error: null }); ROLE = 'student';
    const { GET } = await import('@/app/api/attempts/drawing/route');
    expect((await GET(getReq('stu1/A1/task-1-1.png'))).status).toBe(403);
  });
  it('403 when guardStudentAccess denies a staff caller', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'teacher1' } }, error: null }); ROLE = 'teacher';
    guardStudentAccess.mockResolvedValue(new Response(null, { status: 403 }));
    const { GET } = await import('@/app/api/attempts/drawing/route');
    expect((await GET(getReq('stu1/A1/task-1-1.png'))).status).toBe(403);
  });
  it('400 on a traversal path and never reaches the download', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'stu1' } }, error: null });
    const { GET } = await import('@/app/api/attempts/drawing/route');
    expect((await GET(getReq('stu1/../x'))).status).toBe(400);
    expect(downloads).toHaveLength(0);
  });
  it('404 when the download returns no data', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'stu1' } }, error: null });
    DOWNLOAD = { data: null, error: { message: 'x' } };
    const { GET } = await import('@/app/api/attempts/drawing/route');
    expect((await GET(getReq('stu1/A1/task-1-1.png'))).status).toBe(404);
  });
  it('serves the exact stored bytes', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'stu1' } }, error: null });
    DOWNLOAD = { data: new Blob([new Uint8Array([7, 8, 9])], { type: 'image/png' }), error: null };
    const { GET } = await import('@/app/api/attempts/drawing/route');
    const res = await GET(getReq('stu1/A1/task-1-1.png'));
    expect(res.status).toBe(200);
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([7, 8, 9]);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toBe('inline');
  });
  it('serves a .jpg path with content-type image/jpeg', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'stu1' } }, error: null });
    const { GET } = await import('@/app/api/attempts/drawing/route');
    const res = await GET(getReq('stu1/A1/task-1-1.jpg'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/image\/jpeg/);
  });
});
