// src/app/api/teacher/lessons/upload/route.ts
// POST multipart — store a lesson file in the private lesson-uploads bucket + create a draft lesson.
// Auth chain: getUser → TEACHER_ROLES → guardClassAccess(class_id) → admin write. Exact file_hash dup
// → 409 (unless force). The Upload UI then chains the EXISTING parse + quiz-generate routes (Task 6).
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardClassAccess } from '@/lib/auth/guards';

const ALLOWED = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const TEACHER_ROLES = new Set<string>(STAFF_ROLES);

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminSupabaseClient();
  const { data: profile } = await admin.from('users').select('role').eq('id', user.id).maybeSingle();
  const role = (profile as { role?: string } | null)?.role;
  if (!role || !TEACHER_ROLES.has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const form = await req.formData();
  const file = form.get('file') as File | null;
  const classId = form.get('class_id') as string | null;
  const force = form.get('force') === 'true';
  if (!file || !classId) return NextResponse.json({ error: 'Missing file or class_id' }, { status: 400 });
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: 'Unsupported file type — upload a PDF, Word doc, or text file.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'That file is too large (15 MB max).' }, { status: 400 });

  const guard = await guardClassAccess(classId);
  if (guard) return guard;

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileHash = createHash('sha256').update(buffer).digest('hex');

  if (!force) {
    const { data: dup } = await admin.from('lessons')
      .select('id, title, created_at')
      .eq('teacher_id', user.id).eq('file_hash', fileHash).neq('status', 'archived')
      .limit(1).maybeSingle();
    if (dup) {
      const d = dup as { id: string; title: string | null; created_at: string };
      return NextResponse.json({
        duplicate: true, existing_lesson_id: d.id, existing_title: d.title, existing_created_at: d.created_at,
        message: 'You already uploaded this file.',
      }, { status: 409 });
    }
  }

  const path = `${user.id}/${classId}/${Date.now()}_${file.name}`;
  const { error: upErr } = await admin.storage.from('lesson-uploads').upload(path, buffer, { contentType: file.type });
  if (upErr) return NextResponse.json({ error: 'Upload failed — try again.' }, { status: 500 });
  const { data: pub } = admin.storage.from('lesson-uploads').getPublicUrl(path);

  const { data: row, error: insErr } = await admin.from('lessons').insert({
    class_id: classId, teacher_id: user.id, file_name: file.name, file_url: pub.publicUrl,
    file_type: file.type, file_hash: fileHash, status: 'draft', source: 'upload',
  }).select('id, file_url, file_name, file_type').single();
  if (insErr || !row) return NextResponse.json({ error: 'Could not save the lesson.' }, { status: 500 });

  const r = row as { id: string; file_url: string; file_name: string; file_type: string };
  return NextResponse.json(
    { lesson_id: r.id, file_url: r.file_url, file_name: r.file_name, file_type: r.file_type },
    { status: 201 },
  );
}

export async function GET() {
  return NextResponse.json({ error: 'Not implemented' }, { status: 501 });
}
