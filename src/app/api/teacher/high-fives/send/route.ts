import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardClassAccess } from '@/lib/auth/guards';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { validateHighFive } from '@/lib/highfives/guardrail';

const STAFF = new Set<string>(STAFF_ROLES);

export async function POST(req: Request): Promise<NextResponse> {
  let body: { student_id?: unknown; class_id?: unknown; text?: unknown; reason_hint?: unknown; ai_drafted?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  const studentId = typeof body.student_id === 'string' ? body.student_id : null;
  const classId = typeof body.class_id === 'string' ? body.class_id : null;
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!studentId || !classId) return NextResponse.json({ error: 'student_id and class_id required' }, { status: 400 });
  if (text.length === 0 || text.length > 600) return NextResponse.json({ error: 'text must be 1–600 chars' }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single();
  const role = profile?.role ?? null;
  if (!role || !STAFF.has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Guardrail re-validation server-side (fail-closed) — cannot be bypassed by the client.
  const violations = validateHighFive(text);
  if (violations.length > 0) return NextResponse.json({ violations }, { status: 422 });

  const guard = await guardClassAccess(classId);
  if (guard) return guard;

  const admin = createAdminSupabaseClient();
  const { data: enrolled } = await admin.from('enrollments').select('student_id').eq('class_id', classId).eq('student_id', studentId).maybeSingle();
  if (!enrolled) return NextResponse.json({ error: 'Student not in class' }, { status: 403 });
  const { data: cls } = await admin.from('classes').select('school_id').eq('id', classId).maybeSingle();
  const schoolId = (cls as { school_id?: string } | null)?.school_id;
  if (!schoolId) return NextResponse.json({ error: 'Class not found' }, { status: 404 });

  const { data: inserted, error } = await admin.from('high_fives').insert({
    school_id: schoolId, class_id: classId, student_id: studentId, author_id: user.id,
    note_text: text, reason_hint: typeof body.reason_hint === 'string' ? body.reason_hint : null,
    ai_drafted: body.ai_drafted === true,
  }).select('id').single();
  if (error || !inserted) { console.error('high_fives insert failed', error); return NextResponse.json({ error: 'Write failed' }, { status: 500 }); }
  return NextResponse.json({ ok: true, id: (inserted as { id: string }).id });
}
