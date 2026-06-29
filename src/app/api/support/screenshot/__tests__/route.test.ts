// src/app/api/support/screenshot/__tests__/route.test.ts
// Node env — no jsdom needed (server route test).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── State variables ──────────────────────────────────────────────────────────
const getUser = vi.fn();

let USER_ROLE = 'teacher';
let TICKET_ROW: { submitted_by: string } | null = null;
let DOWNLOAD: { data: Blob | null; error: unknown };

const uploadCalls: Array<{ path: string; contentType: string }> = [];
const downloadPaths: string[] = [];

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: (table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { role: USER_ROLE } }),
            }),
          }),
        };
      }
      // support_tickets — used by GET ownership check
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: TICKET_ROW }),
          }),
        }),
      };
    },
    storage: {
      from: () => ({
        upload: async (path: string, _buf: Buffer, opts: { contentType: string }) => {
          uploadCalls.push({ path, contentType: opts.contentType });
          return { data: { path }, error: null };
        },
        download: async (path: string) => {
          downloadPaths.push(path);
          return DOWNLOAD;
        },
      }),
    },
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function postReq(form: FormData) {
  return new NextRequest('http://x/api/support/screenshot', { method: 'POST', body: form });
}

function getReq(path: string) {
  return new NextRequest(
    `http://x/api/support/screenshot?path=${encodeURIComponent(path)}`,
  );
}

function getReqNoPath() {
  return new NextRequest('http://x/api/support/screenshot');
}

function fd(over: Record<string, string | Blob> = {}) {
  const f = new FormData();
  f.append('file', new Blob([new Uint8Array(100)], { type: 'image/png' }), 'screen.png');
  for (const [k, v] of Object.entries(over)) f.set(k, v);
  return f;
}

async function load() {
  vi.resetModules();
  return await import('@/app/api/support/screenshot/route');
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  getUser.mockReset();
  uploadCalls.length = 0;
  downloadPaths.length = 0;
  USER_ROLE = 'teacher';
  TICKET_ROW = { submitted_by: 'u1' };
  DOWNLOAD = { data: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), error: null };
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
});

// ─── POST tests ───────────────────────────────────────────────────────────────

describe('POST /api/support/screenshot', () => {
  it('returns 401 without a user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { POST } = await load();
    expect((await POST(postReq(fd()))).status).toBe(401);
  });

  it('returns 400 when no file field is present', async () => {
    const { POST } = await load();
    const form = new FormData();
    expect((await POST(postReq(form))).status).toBe(400);
  });

  it('returns 415 for application/pdf', async () => {
    const { POST } = await load();
    const f = fd({ file: new Blob(['%PDF'], { type: 'application/pdf' }) });
    expect((await POST(postReq(f))).status).toBe(415);
  });

  it('returns 415 for text/plain', async () => {
    const { POST } = await load();
    const f = fd({ file: new Blob(['hello'], { type: 'text/plain' }) });
    expect((await POST(postReq(f))).status).toBe(415);
  });

  it('returns 413 when image/png file exceeds 5 MB', async () => {
    const { POST } = await load();
    const bigBlob = new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/png' });
    const f = fd({ file: bigBlob });
    expect((await POST(postReq(f))).status).toBe(413);
  });

  it('returns 201 with path starting with support-uploads/{userId}/ for image/png', async () => {
    const { POST } = await load();
    const res = await POST(postReq(fd()));
    expect(res.status).toBe(201);
    const body = await res.json() as { path: string };
    expect(body.path).toMatch(/^support-uploads\/u1\//);
  });
});

// ─── GET tests ────────────────────────────────────────────────────────────────

describe('GET /api/support/screenshot', () => {
  it('returns 401 without a user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { GET } = await load();
    expect((await GET(getReqNoPath())).status).toBe(401);
  });

  it('returns 400 when path param is missing', async () => {
    const { GET } = await load();
    expect((await GET(getReqNoPath())).status).toBe(400);
  });

  it('returns 400 for a path containing .. and never reaches download', async () => {
    const { GET } = await load();
    const res = await GET(getReq('support-uploads/u1/../u2/shot.png'));
    expect(res.status).toBe(400);
    expect(downloadPaths).toHaveLength(0);
  });

  it('returns 400 when path does not start with support-uploads/ and never reaches download', async () => {
    const { GET } = await load();
    const res = await GET(getReq('avatars/u1/photo.png'));
    expect(res.status).toBe(400);
    expect(downloadPaths).toHaveLength(0);
  });

  it('returns 200 for platform_admin with any valid path (bypasses ownership check)', async () => {
    USER_ROLE = 'platform_admin';
    const { GET } = await load();
    const res = await GET(getReq('support-uploads/u1/screen.png'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('returns 200 for the submitter with their own screenshot path', async () => {
    USER_ROLE = 'teacher';
    TICKET_ROW = { submitted_by: 'u1' };
    const { GET } = await load();
    const res = await GET(getReq('support-uploads/u1/screen.png'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=300');
  });

  it('returns 403 for a non-admin user who is not the ticket submitter', async () => {
    USER_ROLE = 'teacher';
    TICKET_ROW = { submitted_by: 'other-user' };
    const { GET } = await load();
    const res = await GET(getReq('support-uploads/u1/screen.png'));
    expect(res.status).toBe(403);
  });

  it('returns 404 when no ticket matches the screenshot_path', async () => {
    USER_ROLE = 'teacher';
    TICKET_ROW = null;
    const { GET } = await load();
    const res = await GET(getReq('support-uploads/u1/screen.png'));
    expect(res.status).toBe(404);
  });
});
