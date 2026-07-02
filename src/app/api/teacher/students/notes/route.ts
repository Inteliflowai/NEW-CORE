// Private per-student teacher notes (drill-in "Add note").
// PRIVACY CONTRACT: notes are visible ONLY to their author — every SELECT
// filters author_id = caller. Auth mirrors high-fives/send:
// getUser → STAFF_ROLES → guardStudentAccess (IDOR; RLS is NOT the backstop).
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardStudentAccess } from '@/lib/auth/guards';

const MAX_NOTE = 2000;

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;
type StaffCtx = NextResponse | { user: { id: string }; admin: AdminClient };

// NextResponse | { user, admin } — the same two-member-union idiom as
// guardStudentAccess/guardClassAccess (NextResponse | null): `instanceof
// NextResponse` narrows cleanly (unlike a `{ fail } | { user, admin }` shape,
// which TS's control-flow narrowing does not discriminate reliably here).
async function requireStaff(): Promise<StaffCtx> {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const admin = createAdminSupabaseClient();
  const { data: roleRow } = await admin.from('users').select('role').eq('id', user.id).maybeSingle();
  const role = (roleRow as { role?: string } | null)?.role;
  if (!role || !new Set<string>(STAFF_ROLES).has(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return { user, admin };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireStaff();
  if (ctx instanceof NextResponse) return ctx;
  const { user, admin } = ctx;

  let body: { student_id?: string; class_id?: string | null; text?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  const studentId = body.student_id;
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!studentId || text.length === 0 || text.length > MAX_NOTE) {
    return NextResponse.json({ error: 'A note needs between 1 and 2000 characters.' }, { status: 400 });
  }

  const guard = await guardStudentAccess(studentId);
  if (guard) return guard;

  const { data: student } = await admin.from('users').select('school_id').eq('id', studentId).maybeSingle();
  const schoolId = (student as { school_id?: string } | null)?.school_id ?? null;

  const { data: row, error: insErr } = await admin.from('student_notes')
    .insert({
      student_id: studentId,
      author_id: user.id,
      // string-validate like high-fives/send does — a non-string here is a
      // Postgres type error → 500, and junk FK refs shouldn't be storable
      class_id: typeof body.class_id === 'string' ? body.class_id : null,
      school_id: schoolId,
      note_text: text,
    })
    .select('id')
    .single();
  if (insErr || !row) return NextResponse.json({ error: 'Could not save the note.' }, { status: 500 });
  return NextResponse.json({ ok: true, id: (row as { id: string }).id });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireStaff();
  if (ctx instanceof NextResponse) return ctx;
  const { user, admin } = ctx;

  const studentId = new URL(req.url).searchParams.get('studentId');
  if (!studentId) return NextResponse.json({ error: 'Missing studentId' }, { status: 400 });

  const guard = await guardStudentAccess(studentId);
  if (guard) return guard;

  const { data } = await admin.from('student_notes')
    .select('id, note_text, created_at')
    .eq('student_id', studentId)
    .eq('author_id', user.id) // PRIVACY: own notes only
    .order('created_at', { ascending: false })
    .limit(5);
  return NextResponse.json({ notes: data ?? [] });
}
