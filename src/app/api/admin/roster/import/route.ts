// src/app/api/admin/roster/import/route.ts
//
// POST /api/admin/roster/import
//
// Despite the /admin/ path, this is open to STAFF_ROLES (teacher-run full import,
// Marvin 2026-06-24); each non-platform caller is pinned to their own school.
//
// Full 5-sheet roster import. Accepts a multipart/form-data upload of an XLSX
// workbook and either previews the parsed counts (mode=preview, default) or
// commits the import by running the engine (mode=commit).
//
// Auth chain:
//   getUser() → 401 on failure
//   profile.role in STAFF_ROLES → 403 else
//   platform_admin: must supply 'schoolId' form field (400 if missing)
//   non-platform (teacher/school_admin/school_sysadmin): pinned to profile.school_id;
//     any form schoolId field is IGNORED (own-school-pinning)
//
// This route uses xlsx (SheetJS) via parseRosterWorkbook, which needs the Node runtime.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { parseRosterWorkbook } from '@/lib/roster/parseWorkbook';
import { importRoster } from '@/lib/roster/importRoster';
import { logAudit } from '@/lib/audit/logAudit';

export const runtime = 'nodejs';

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('users')
    .select('role, school_id')
    .eq('id', user.id)
    .single();

  const role = profile?.role ?? null;
  if (!role || !(STAFF_ROLES as readonly string[]).includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const isPlatformAdmin = role === 'platform_admin';

  // ── Parse form ──────────────────────────────────────────────────────────────
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Could not parse form data' }, { status: 400 });
  }

  const fileField = form.get('file');
  const mode = (form.get('mode') as string | null) ?? 'preview';
  const schoolIdField = (form.get('schoolId') as string | null)?.trim() ?? '';

  // ── Resolve schoolId ────────────────────────────────────────────────────────
  let schoolId: string;
  if (isPlatformAdmin) {
    // platform_admin has no inherent school — must supply it explicitly
    if (!schoolIdField) {
      return NextResponse.json(
        { error: 'schoolId is required for platform_admin callers' },
        { status: 400 },
      );
    }
    schoolId = schoolIdField;
  } else {
    // teacher / school_admin / school_sysadmin — pinned to their own school;
    // any form schoolId field is intentionally IGNORED (own-school-pinning)
    const profileSchoolId = profile?.school_id ?? null;
    if (!profileSchoolId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    schoolId = profileSchoolId;
  }

  // ── Validate file ───────────────────────────────────────────────────────────
  if (!fileField || typeof fileField === 'string') {
    return NextResponse.json({ error: 'A file field (Blob) is required' }, { status: 400 });
  }

  const file = fileField as File;

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `File too large — maximum is ${MAX_FILE_BYTES / (1024 * 1024)} MB` },
      { status: 413 },
    );
  }

  // ── MIME / extension check (full import requires .xlsx — 5-sheet workbook) ──
  const fileName = (file as File).name ?? '';
  const mimeOk = file.type === XLSX_MIME || fileName.endsWith('.xlsx');
  if (!mimeOk) {
    return NextResponse.json(
      { error: 'Unsupported file type — the full roster import requires an .xlsx workbook' },
      { status: 415 },
    );
  }

  // ── Core logic ───────────────────────────────────────────────────────────────
  try {
    const bytes = await file.arrayBuffer();
    const { roster, issues } = parseRosterWorkbook(bytes);

    if (mode === 'commit') {
      const admin = createAdminSupabaseClient();
      const summary = await importRoster(admin, { schoolId, roster });
      console.info('[roster-import] actor=%s school=%s summary=%o', user.id, schoolId, summary);
      // Log audit on successful commit (best-effort, never-fatal)
      await logAudit(admin, {
        actorId:      user.id,
        schoolId,
        action:       'roster.import',
        resourceType: 'school',
        resourceId:   schoolId,
        metadata: {
          studentsCreated:    summary.students.created,
          enrollmentsCreated: summary.enrollments.created,
        },
      });
      return NextResponse.json({ mode: 'commit', summary });
    }

    // Default: preview — return counts + issues, NO writes
    return NextResponse.json({
      mode: 'preview',
      counts: {
        teachers:    roster.teachers.length,
        classes:     roster.classes.length,
        students:    roster.students.length,
        enrollments: roster.enrollments.length,
        parents:     roster.parents.length,
      },
      issues,
    });
  } catch (err) {
    console.error('[roster-import] unexpected error actor=%s school=%s', user.id, schoolId, err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
