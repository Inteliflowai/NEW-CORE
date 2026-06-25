// POST /api/teacher/roster/import — teacher uploads a students CSV/xlsx file and
// enrolls them into their currently-selected class. Auth: STAFF_ROLES + per-class
// IDOR guard (guardClassAccess). schoolId is derived from the CLASS record (not the
// caller's profile) so dedup/create happens under the class's school, never a
// divergent profile school. No migration needed — reuses existing tables.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardClassAccess } from '@/lib/auth/guards';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { parseStudentSheet } from '@/lib/roster/parseWorkbook';
import { importStudentsToClass } from '@/lib/roster/importStudentsToClass';
import { logAudit } from '@/lib/audit/logAudit';

export const runtime = 'nodejs';

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_MIME  = 'text/csv';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth chain ────────────────────────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single();
  const role = profile?.role ?? null;
  if (!role || !(STAFF_ROLES as readonly string[]).includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

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

  // ── MIME / extension check (lean import accepts .xlsx OR .csv) ────────────────
  const file = fileField as File;
  const fileName = file.name ?? '';
  const mimeOk =
    file.type === XLSX_MIME ||
    file.type === CSV_MIME ||
    fileName.endsWith('.xlsx') ||
    fileName.endsWith('.csv');
  if (!mimeOk) {
    return NextResponse.json(
      { error: 'Unsupported file type — please upload a .csv or .xlsx file' },
      { status: 415 },
    );
  }

  const classId = (form.get('classId') as string | null)?.trim() ?? '';
  if (!classId) {
    return NextResponse.json({ error: 'classId field is required' }, { status: 400 });
  }

  // ── IDOR guard — must come AFTER we have classId ─────────────────────────────
  const denied = await guardClassAccess(classId);
  if (denied) return denied;

  // ── Derive schoolId from the CLASS (not the caller's profile) ─────────────────
  // This ensures student create/dedup happens under the class's school, even if
  // the caller's profile.school_id were somehow divergent.
  const admin = createAdminSupabaseClient();
  const { data: cls } = await admin
    .from('classes')
    .select('school_id')
    .eq('id', classId)
    .maybeSingle();
  const schoolId = cls?.school_id ?? null;
  if (!schoolId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── Run the import engine ────────────────────────────────────────────────────
  try {
    const { students } = parseStudentSheet(await file.arrayBuffer());
    const summary = await importStudentsToClass(admin, { schoolId, classId, students });
    console.info('[roster-import-lean] actor=%s class=%s summary=%o', user.id, classId, summary);
    // Log audit on successful commit (best-effort, never-fatal)
    await logAudit(admin, {
      actorId:      user.id,
      schoolId,
      action:       'roster.import',
      resourceType: 'class',
      resourceId:   classId,
      metadata: {
        studentsCreated: summary.studentsCreated,
        enrolled:        summary.enrolled,
        errors:          summary.errors,
      },
    });
    return NextResponse.json({ summary });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
