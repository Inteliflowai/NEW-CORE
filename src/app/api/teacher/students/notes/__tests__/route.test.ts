// @vitest-environment node
// Idiom: mirror high-fives/send route test mocks. The admin-client fake needs
// a 'users' row { role: 'teacher' } and a chainable student_notes builder that
// records inserts and select filters (capture .eq calls — the author_id
// scoping assertion is the point of this suite).
import { describe, it, expect, vi, beforeEach } from 'vitest';

type EqCall = [string, unknown];
type RecordedSelect = { eqCalls: EqCall[]; order?: [string, unknown]; limit?: number };

const getUser = vi.fn();
const guardStudentAccess = vi.fn();

let ROLE: string | null;
let STUDENT_ROW: unknown; // { school_id } row served by the school_id lookup
let INSERT_RESULT: unknown;
let NOTES_RESULT: unknown; // rows served by the GET select chain

const inserts: Array<Record<string, unknown>> = [];
const selectCalls: RecordedSelect[] = [];

vi.mock('@/lib/auth/roles', () => ({
  STAFF_ROLES: ['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'] as const,
}));

vi.mock('@/lib/auth/guards', () => ({ guardStudentAccess }));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser },
  }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'users') {
        // Hit TWICE with different shapes: requireStaff's select('role') for
        // the caller, and the route's select('school_id') for the student.
        // Discriminate on the select() column argument.
        return {
          select: (cols: string) => ({
            eq: (_field: string, _value: unknown) => ({
              maybeSingle: async () => {
                if (cols === 'role') return { data: ROLE !== null ? { role: ROLE } : null };
                if (cols === 'school_id') return { data: STUDENT_ROW };
                return { data: null };
              },
            }),
          }),
        };
      }
      if (t === 'student_notes') {
        return {
          insert: (payload: Record<string, unknown>) => {
            inserts.push(payload);
            return {
              select: () => ({
                single: async () => INSERT_RESULT,
              }),
            };
          },
          select: (_cols: string) => {
            const rec: RecordedSelect = { eqCalls: [] };
            const builder = {
              eq: (field: string, value: unknown) => {
                rec.eqCalls.push([field, value]);
                return builder;
              },
              order: (field: string, opts: unknown) => {
                rec.order = [field, opts];
                return builder;
              },
              limit: (n: number) => {
                rec.limit = n;
                selectCalls.push(rec);
                return Promise.resolve({ data: NOTES_RESULT });
              },
            };
            return builder;
          },
        };
      }
      return {};
    },
  }),
}));

const postReq = (b: unknown) =>
  new Request('http://x/api/teacher/students/notes', {
    method: 'POST',
    body: JSON.stringify(b),
  }) as unknown as import('next/server').NextRequest;

const getReq = (studentId: string | null) =>
  new Request(
    `http://x/api/teacher/students/notes${studentId ? `?studentId=${studentId}` : ''}`,
    { method: 'GET' },
  ) as unknown as import('next/server').NextRequest;

async function loadRoute() {
  vi.resetModules();
  return import('@/app/api/teacher/students/notes/route');
}

const VALID_BODY = { student_id: 's1', text: 'Ann has been quietly more confident this week.' };

beforeEach(() => {
  getUser.mockReset();
  guardStudentAccess.mockReset();
  inserts.length = 0;
  selectCalls.length = 0;
  ROLE = 'teacher';
  STUDENT_ROW = { school_id: 'school1' };
  INSERT_RESULT = { data: { id: 'note1' }, error: null };
  NOTES_RESULT = [];
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  guardStudentAccess.mockResolvedValue(null); // access granted
});

describe('POST /api/teacher/students/notes', () => {
  it('400 on unparseable JSON body', async () => {
    const { POST } = await loadRoute();
    const req = new Request('http://x/api/teacher/students/notes', {
      method: 'POST',
      body: 'not json',
    }) as unknown as import('next/server').NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(inserts.length).toBe(0);
  });

  it('401 when unauthenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { POST } = await loadRoute();
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(401);
    expect(inserts.length).toBe(0);
  });

  it('403 for non-staff roles', async () => {
    ROLE = 'student';
    const { POST } = await loadRoute();
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(403);
    expect(inserts.length).toBe(0);
  });

  it('400 on missing student_id / empty text / text > 2000 chars', async () => {
    const { POST } = await loadRoute();

    const missingStudent = await POST(postReq({ text: 'Some note.' }));
    expect(missingStudent.status).toBe(400);

    const emptyText = await POST(postReq({ student_id: 's1', text: '' }));
    expect(emptyText.status).toBe(400);

    const tooLong = await POST(postReq({ student_id: 's1', text: 'A'.repeat(2001) }));
    expect(tooLong.status).toBe(400);

    expect(inserts.length).toBe(0);
  });

  it('IDOR: returns the guard response and never inserts when guardStudentAccess denies', async () => {
    guardStudentAccess.mockResolvedValue(new Response(null, { status: 403 }));
    const { POST } = await loadRoute();
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(403);
    expect(inserts.length).toBe(0);
  });

  it('inserts with author_id = caller and returns { ok: true, id }', async () => {
    const { POST } = await loadRoute();

    // No class_id in body -> stored as null; school_id resolved from the student row.
    const res = await POST(postReq({ ...VALID_BODY, text: '  Ann did great today.  ' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBe('note1');
    expect(inserts.length).toBe(1);
    expect(inserts[0]).toMatchObject({
      student_id: 's1',
      author_id: 'u1',
      note_text: 'Ann did great today.', // trimmed
      class_id: null,
      school_id: 'school1',
    });

    // class_id passed through when present.
    const res2 = await POST(postReq({ ...VALID_BODY, class_id: 'c1' }));
    expect(res2.status).toBe(200);
    expect(inserts[1]).toMatchObject({ class_id: 'c1' });
  });
});

describe('GET /api/teacher/students/notes', () => {
  it('400 without studentId', async () => {
    const { GET } = await loadRoute();
    const res = await GET(getReq(null));
    expect(res.status).toBe(400);
  });

  it('IDOR: guard response short-circuits the query', async () => {
    guardStudentAccess.mockResolvedValue(new Response(null, { status: 403 }));
    const { GET } = await loadRoute();
    const res = await GET(getReq('s1'));
    expect(res.status).toBe(403);
    expect(selectCalls.length).toBe(0);
  });

  it("AUTHOR-PRIVACY: the select filters author_id = caller (never another teacher's notes)", async () => {
    const { GET } = await loadRoute();
    const res = await GET(getReq('s1'));
    expect(res.status).toBe(200);
    expect(selectCalls.length).toBe(1);
    expect(selectCalls[0].eqCalls).toContainEqual(['author_id', 'u1']);
    expect(selectCalls[0].eqCalls).toContainEqual(['student_id', 's1']);
  });

  it('returns newest-first notes limited to 5', async () => {
    NOTES_RESULT = [
      { id: 'n1', note_text: 'first', created_at: '2026-07-01T00:00:00Z' },
      { id: 'n2', note_text: 'second', created_at: '2026-06-30T00:00:00Z' },
    ];
    const { GET } = await loadRoute();
    const res = await GET(getReq('s1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notes).toEqual(NOTES_RESULT);
    expect(selectCalls[0].order).toEqual(['created_at', { ascending: false }]);
    expect(selectCalls[0].limit).toBe(5);
  });
});
