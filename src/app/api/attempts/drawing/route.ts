// src/app/api/attempts/drawing/route.ts
// POST — a student uploads a drawing/photo for one task of their in-progress attempt.
// GET  — auth'd image proxy: serves a stored drawing (student-owns OR staff-with-access).
// Drawings live in the PRIVATE 'student-drawings' bucket; the persisted image_url is a proxy
// link to THIS GET (never a public/expiring URL). Path = {student_id}/{attempt_id}/task-{step}-{ts}.ext.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardStudentAccess } from '@/lib/auth/guards';

const BUCKET = 'student-drawings';
const MAX_BYTES = 8 * 1024 * 1024;
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
function contentTypeForPath(path: string): string {
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  const file = form.get('file');
  const attemptId = String(form.get('attempt_id') ?? '');
  const step = String(form.get('step') ?? '');
  if (!(file instanceof Blob) || !attemptId || !step) return NextResponse.json({ error: 'Missing file, attempt_id, or step' }, { status: 400 });
  if (!/^\d+$/.test(step)) return NextResponse.json({ error: 'Bad step' }, { status: 400 });
  const ext = EXT[file.type];
  if (!ext) return NextResponse.json({ error: 'Only PNG, JPEG, or WebP images are allowed.' }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'That image is too large (max 8 MB).' }, { status: 413 });

  const admin = createAdminSupabaseClient();
  const { data: attempt } = await admin.from('homework_attempts')
    .select('id, student_id, status').eq('id', attemptId).eq('student_id', user.id).maybeSingle();
  const a = attempt as { id: string; status: string } | null;
  if (!a) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
  if (a.status !== 'in_progress') return NextResponse.json({ error: 'Attempt not editable' }, { status: 409 });

  const path = `${user.id}/${attemptId}/task-${step}-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { data, error: upErr } = await admin.storage.from(BUCKET).upload(path, buffer, { contentType: file.type, upsert: true });
  if (upErr || !data) return NextResponse.json({ error: 'Upload failed — try again.' }, { status: 500 });

  return NextResponse.json({ image_url: `/api/attempts/drawing?path=${encodeURIComponent(path)}` });
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const path = new URL(req.url).searchParams.get('path');
  if (!path || path.includes('..')) return NextResponse.json({ error: 'Bad path' }, { status: 400 });
  // Well-formed key shape: {student_id}/{attempt_id}/{file}. Reject anything shorter so a
  // bare/owner-less path can't slip past the ownership check below.
  const segs = path.split('/');
  if (segs.length < 3 || !segs[0]) return NextResponse.json({ error: 'Bad path' }, { status: 400 });
  const ownerId = segs[0];

  const admin = createAdminSupabaseClient();
  if (user.id !== ownerId) {
    // Not the owning student → must be staff WITH access to that student.
    const { data: roleRow } = await admin.from('users').select('role').eq('id', user.id).maybeSingle();
    const role = (roleRow as { role?: string } | null)?.role;
    if (!role || !new Set<string>(STAFF_ROLES).has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const guard = await guardStudentAccess(ownerId);
    if (guard) return guard;
  }

  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const bytes = Buffer.from(await data.arrayBuffer());
  // Serving untrusted student-uploaded bytes: pin the sniffed type + force inline display so the
  // browser can't be coaxed into treating the payload as a different content type.
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': contentTypeForPath(path),
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    },
  });
}
