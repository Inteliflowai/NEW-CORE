// src/app/api/admin/roster/import/route.ts
//
// POST /api/admin/roster/import
//
// School-admin-tier full roster import. Accepts a multipart/form-data upload of
// an XLSX workbook and either previews the parsed counts (mode=preview, default)
// or commits the import by running the engine (mode=commit).
//
// Auth chain:
//   guardSchoolAdmin() → 401/403 on failure
//   platform_admin callers have g.schoolId === null → must supply 'schoolId' in the form
//
// This route uses xlsx (SheetJS) via parseRosterWorkbook, which needs the Node
// runtime (not the Edge runtime).

import { NextRequest, NextResponse } from 'next/server';
import { guardSchoolAdmin } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { parseRosterWorkbook } from '@/lib/roster/parseWorkbook';
import { importRoster } from '@/lib/roster/importRoster';

export const runtime = 'nodejs';

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const g = await guardSchoolAdmin();
  if ('error' in g) return g.error;

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
  if (g.isPlatformAdmin) {
    // platform_admin has g.schoolId === null — must supply it explicitly
    if (!schoolIdField) {
      return NextResponse.json(
        { error: 'schoolId is required for platform_admin callers' },
        { status: 400 },
      );
    }
    schoolId = schoolIdField;
  } else {
    // school_admin / school_sysadmin — scope is their own school
    schoolId = g.schoolId as string;
  }

  // ── Validate file ───────────────────────────────────────────────────────────
  if (!fileField || typeof fileField === 'string') {
    return NextResponse.json({ error: 'A file field (Blob) is required' }, { status: 400 });
  }

  const file = fileField as Blob;

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `File too large — maximum is ${MAX_FILE_BYTES / (1024 * 1024)} MB` },
      { status: 413 },
    );
  }

  // ── Core logic ───────────────────────────────────────────────────────────────
  try {
    const bytes = await file.arrayBuffer();
    const { roster, issues } = parseRosterWorkbook(bytes);

    if (mode === 'commit') {
      const admin = createAdminSupabaseClient();
      const summary = await importRoster(admin, { schoolId, roster });
      console.info('[roster-import] actor=%s school=%s summary=%o', g.userId, schoolId, summary);
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
    console.error('[roster-import] unexpected error actor=%s school=%s', g.userId, schoolId, err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
