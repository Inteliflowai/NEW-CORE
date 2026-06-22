import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardClassAccess } from '@/lib/auth/guards';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { generateHighFiveDraft } from '@/lib/highfives/generateDraft';

const STAFF = new Set<string>(STAFF_ROLES);

export async function POST(req: Request): Promise<NextResponse> {
  let body: { student_id?: unknown; class_id?: unknown; reason_hint?: unknown; context_hint?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  const studentId = typeof body.student_id === 'string' ? body.student_id : null;
  const classId = typeof body.class_id === 'string' ? body.class_id : null;
  if (!studentId || !classId) return NextResponse.json({ error: 'student_id and class_id required' }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single();
  const role = (profile as { role?: string } | null)?.role ?? null;
  if (!role || !STAFF.has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const guard = await guardClassAccess(classId);
  if (guard) return guard;

  const admin = createAdminSupabaseClient();
  const { data: enrolled } = await admin.from('enrollments').select('student_id').eq('class_id', classId).eq('student_id', studentId).maybeSingle();
  if (!enrolled) return NextResponse.json({ error: 'Student not in class' }, { status: 403 });
  const { data: stu } = await admin.from('users').select('full_name').eq('id', studentId).maybeSingle();
  const firstName = ((stu as { full_name?: string } | null)?.full_name ?? 'there').split(' ')[0];

  const out = await generateHighFiveDraft({
    studentName: firstName,
    reasonHint: typeof body.reason_hint === 'string' ? body.reason_hint : undefined,
    contextHint: typeof body.context_hint === 'string' ? body.context_hint : undefined,
  });
  return NextResponse.json(out);
}
