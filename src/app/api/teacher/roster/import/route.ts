// POST /api/teacher/roster/import — teacher uploads a students CSV/xlsx file and
// enrolls them into their currently-selected class. Auth: teacher role + per-class
// IDOR guard (guardClassAccess). No migration needed — reuses existing tables.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardClassAccess } from '@/lib/auth/guards';
import { parseStudentSheet } from '@/lib/roster/parseWorkbook';
import { importStudentsToClass } from '@/lib/roster/importStudentsToClass';

export const runtime = 'nodejs';

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth chain (mirrors google/import-roster) ────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('users').select('role, school_id').eq('id', user.id).single();
  if ((profile?.role ?? null) !== 'teacher') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const schoolId = profile?.school_id ?? null;
  if (!schoolId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // ── Parse multipart form ─────────────────────────────────────────────────────
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  const fileField = form.get('file');
  if (!fileField || !(fileField instanceof Blob)) {
    return NextResponse.json({ error: 'file field is required' }, { status: 400 });
  }
  if (fileField.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'File too large (max 5 MB)' }, { status: 413 });
  }

  const classId = (form.get('classId') as string | null)?.trim() ?? '';
  if (!classId) {
    return NextResponse.json({ error: 'classId field is required' }, { status: 400 });
  }

  // ── IDOR guard — must come AFTER we have classId ─────────────────────────────
  const denied = await guardClassAccess(classId);
  if (denied) return denied;

  // ── Run the import engine ────────────────────────────────────────────────────
  const admin = createAdminSupabaseClient();
  try {
    const { students } = parseStudentSheet(await fileField.arrayBuffer());
    const summary = await importStudentsToClass(admin, { schoolId, classId, students });
    console.info('[roster-import-lean] actor=%s class=%s summary=%o', user.id, classId, summary);
    return NextResponse.json({ summary });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
