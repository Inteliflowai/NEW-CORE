import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- mock surfaces -----------------------------------------------------------
const getUser = vi.fn();
const guardClassAccess = vi.fn();

let ROLE: string | undefined; // admin.from('users') role lookup
let DUP: unknown; // admin.from('lessons') exact-hash dup query → .maybeSingle()
let INSERT_ROW: unknown; // admin.from('lessons').insert(...).select().single()
let INSERT_ERROR: unknown; // insert error
let UPLOAD_ERROR: unknown; // storage upload error
const inserts: Array<Record<string, unknown>> = [];
const uploads: Array<{ path: string; opts: unknown }> = [];

vi.mock('@/lib/auth/roles', () => ({
  STAFF_ROLES: ['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'] as const,
}));
vi.mock('@/lib/auth/guards', () => ({ guardClassAccess: (...a: unknown[]) => guardClassAccess(...a) }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'users') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ROLE ? { role: ROLE } : null }) }) }) };
      }
      // lessons
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              neq: () => ({
                limit: () => ({ maybeSingle: async () => ({ data: DUP }) }),
              }),
            }),
          }),
        }),
        insert: (p: Record<string, unknown>) => {
          inserts.push(p);
          return { select: () => ({ single: async () => ({ data: INSERT_ROW, error: INSERT_ERROR }) }) };
        },
      };
    },
    storage: {
      from: () => ({
        upload: async (path: string, _buf: unknown, opts: unknown) => {
          uploads.push({ path, opts });
          return { error: UPLOAD_ERROR };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn/${path}` } }),
      }),
    },
  }),
}));

import { POST } from '../route';

function makeForm(opts: { fileName?: string; fileType?: string; classId?: string | null; force?: boolean; bytes?: string }): FormData {
  const form = new FormData();
  if (opts.fileName !== undefined) {
    form.set('file', new File([opts.bytes ?? 'lesson bytes'], opts.fileName, { type: opts.fileType ?? 'application/pdf' }));
  }
  if (opts.classId !== undefined && opts.classId !== null) form.set('class_id', opts.classId);
  if (opts.force) form.set('force', 'true');
  return form;
}

function req(form: FormData) {
  return new Request('http://x/api/teacher/lessons/upload', { method: 'POST', body: form }) as unknown as import('next/server').NextRequest;
}

beforeEach(() => {
  getUser.mockReset();
  guardClassAccess.mockReset();
  inserts.length = 0;
  uploads.length = 0;
  ROLE = 'teacher';
  DUP = null;
  INSERT_ROW = { id: 'L1', file_url: 'https://cdn/u1/c1/x_l.pdf', file_name: 'l.pdf', file_type: 'application/pdf' };
  INSERT_ERROR = null;
  UPLOAD_ERROR = null;
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  guardClassAccess.mockResolvedValue(null); // access granted
});

describe('POST /api/teacher/lessons/upload', () => {
  it('401 unauthenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(req(makeForm({ fileName: 'l.pdf', classId: 'c1' })));
    expect(res.status).toBe(401);
  });

  it('403 for a non-staff role', async () => {
    ROLE = 'student';
    const res = await POST(req(makeForm({ fileName: 'l.pdf', classId: 'c1' })));
    expect(res.status).toBe(403);
    expect(guardClassAccess).not.toHaveBeenCalled();
  });

  it('400 when file or class_id is missing', async () => {
    const noFile = await POST(req(makeForm({ classId: 'c1' })));
    expect(noFile.status).toBe(400);
    const noClass = await POST(req(makeForm({ fileName: 'l.pdf' })));
    expect(noClass.status).toBe(400);
  });

  it('400 on a disallowed file type', async () => {
    const res = await POST(req(makeForm({ fileName: 'evil.exe', fileType: 'application/x-msdownload', classId: 'c1' })));
    expect(res.status).toBe(400);
  });

  it('returns the guard response on IDOR failure', async () => {
    guardClassAccess.mockResolvedValue(new Response('no', { status: 403 }));
    const res = await POST(req(makeForm({ fileName: 'l.pdf', classId: 'c1' })));
    expect(res.status).toBe(403);
    expect(inserts).toHaveLength(0);
  });

  it('409 on an exact file_hash duplicate (not forced)', async () => {
    DUP = { id: 'Lold', title: 'Photosynthesis', created_at: '2026-01-01T00:00:00Z' };
    const res = await POST(req(makeForm({ fileName: 'l.pdf', classId: 'c1' })));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.duplicate).toBe(true);
    expect(body.existing_lesson_id).toBe('Lold');
    expect(body.existing_title).toBe('Photosynthesis');
    expect(body.existing_created_at).toBe('2026-01-01T00:00:00Z');
    expect(inserts).toHaveLength(0); // never inserts on a hard dup block
  });

  it('force=true bypasses the dup block and inserts', async () => {
    DUP = { id: 'Lold', title: 'Photosynthesis', created_at: '2026-01-01T00:00:00Z' };
    const res = await POST(req(makeForm({ fileName: 'l.pdf', classId: 'c1', force: true })));
    expect(res.status).toBe(201);
    expect(inserts).toHaveLength(1);
  });

  it('201 inserts a draft lesson (source=upload, file_hash set) and returns lesson_id', async () => {
    const res = await POST(req(makeForm({ fileName: 'l.pdf', classId: 'c1' })));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.lesson_id).toBe('L1');
    expect(body.file_url).toBe('https://cdn/u1/c1/x_l.pdf');
    expect(body.file_name).toBe('l.pdf');
    expect(body.file_type).toBe('application/pdf');

    expect(uploads).toHaveLength(1);
    const p = inserts[0];
    expect(p.status).toBe('draft');
    expect(p.source).toBe('upload');
    expect(p.class_id).toBe('c1');
    expect(p.teacher_id).toBe('u1');
    expect(typeof p.file_hash).toBe('string');
    expect((p.file_hash as string).length).toBe(64); // sha256 hex
  });

  it('500 when the storage upload fails', async () => {
    UPLOAD_ERROR = { message: 'storage down' };
    const res = await POST(req(makeForm({ fileName: 'l.pdf', classId: 'c1' })));
    expect(res.status).toBe(500);
    expect(inserts).toHaveLength(0);
  });

  it('500 when the lessons insert returns an error (fail loud)', async () => {
    INSERT_ERROR = { message: 'db down' };
    INSERT_ROW = null;
    const res = await POST(req(makeForm({ fileName: 'l.pdf', classId: 'c1' })));
    expect(res.status).toBe(500);
  });

  it('accepts DOCX and TXT types', async () => {
    const docx = await POST(req(makeForm({ fileName: 'l.docx', fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', classId: 'c1' })));
    expect(docx.status).toBe(201);
    const txt = await POST(req(makeForm({ fileName: 'l.txt', fileType: 'text/plain', classId: 'c1' })));
    expect(txt.status).toBe(201);
  });
});
