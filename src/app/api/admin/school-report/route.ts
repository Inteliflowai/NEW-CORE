// src/app/api/admin/school-report/route.ts
// GET /api/admin/school-report?school=<id>
// Returns a CSV of per-class operational metrics for a school.
//
// Auth: guardSchoolAdmin().
// Non-platform-admin roles are PINNED to their own schoolId — the ?school=
// query param is IGNORED for them (security: non-platform callers must not
// be able to scope to an arbitrary school by manipulating the URL).
// Platform admins may pass ?school=<id>; missing → 400.
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardSchoolAdmin } from '@/lib/auth/guards';
import { loadSchoolReport, type SchoolReport } from '@/lib/school/loadSchoolReport';

// ── CSV builder ───────────────────────────────────────────────────────────────

const CSV_HEADER =
  'classId,className,teacherName,enrolledStudents,assignmentsCreated,assignmentsSubmitted,quizzesPublished';

/** Wrap a value in double-quotes if it contains a comma, double-quote, newline,
 *  or starts with a formula-injection character (=, +, -, @, tab). */
function escapeCsv(v: string | number | null | undefined): string {
  if (v == null) return '';
  const str = String(v);
  const needsQuoting = /[,"\n\r]/.test(str) || /^[=+\-@\t]/.test(str);
  if (needsQuoting) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(report: SchoolReport): string {
  const rows = report.classes.map(c =>
    [
      escapeCsv(c.classId),
      escapeCsv(c.className),
      escapeCsv(c.teacherName),
      c.enrolledStudents,
      c.assignmentsCreated,
      c.assignmentsSubmitted,
      c.quizzesPublished,
    ].join(','),
  );
  return [CSV_HEADER, ...rows].join('\r\n');
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  // Auth + role check
  const ctx = await guardSchoolAdmin();
  if ('error' in ctx) return ctx.error;

  // Scope resolution — non-platform callers are always pinned to their own school
  const url = new URL(request.url);
  const schoolId = ctx.isPlatformAdmin
    ? (url.searchParams.get('school') ?? null)
    : ctx.schoolId;

  if (!schoolId) {
    return Response.json({ error: 'school required' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const report = await loadSchoolReport(admin, schoolId);
  const csv = buildCsv(report);

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="school-report.csv"',
    },
  });
}
