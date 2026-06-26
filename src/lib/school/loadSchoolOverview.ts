// src/lib/school/loadSchoolOverview.ts
// Pure overview loader for the school-admin surface. Caller is responsible for auth
// (resolveAdminContext + createAdminSupabaseClient — RLS bypass; NEVER use this with
// an authed user client). All queries are scoped to schoolId; cross-tenant safety is
// enforced by the explicit .eq('school_id', schoolId) or class→school two-step.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface SchoolOverview {
  schoolName: string;
  license: {
    tier: string | null;
    status: string | null;
    studentLimit: number | null;
    trialEndsAt: string | null;
  };
  seatsUsed: number;
  counts: { students: number; teachers: number; classes: number };
  thisWeek: {
    assignmentsSubmitted: number;
    quizzesPublished: number;
    openAlerts: number;
    highFives: number;
  };
}

export async function loadSchoolOverview(
  admin: SupabaseClient,
  schoolId: string,
): Promise<SchoolOverview> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // ── 1. School name ──────────────────────────────────────────────────────
  const { data: schoolRow } = await admin
    .from('schools')
    .select('name')
    .eq('id', schoolId)
    .single();

  // ── 2. License (optional — demo/unlicensed schools have no row) ─────────
  const { data: licRow } = await admin
    .from('school_licenses')
    .select('tier,status,student_limit,trial_ends_at')
    .eq('school_id', schoolId)
    .maybeSingle();

  // ── 3. Student + teacher counts ─────────────────────────────────────────
  // Matches the `enforce_enrollment_limit` trigger definition: active students
  // in this school. seatsUsed = counts.students (same query).
  const { count: studentCount } = await admin
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('role', 'student')
    .eq('is_active', true);

  const { count: teacherCount } = await admin
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('role', 'teacher')
    .eq('is_active', true);

  // ── 4. Class IDs (also used for this-week queries) ──────────────────────
  // Fetch IDs rather than a COUNT so we can reuse them as the .in() filter
  // for downstream queries without an extra round-trip.
  const { data: classRows } = await admin
    .from('classes')
    .select('id')
    .eq('school_id', schoolId)
    .eq('is_active', true);

  const classIds: string[] = (classRows as Array<{ id: string }> | null)?.map(r => r.id) ?? [];
  const classCount = classIds.length;

  // ── 5. This-week activity ────────────────────────────────────────────────
  // Guard: skip .in([]) — Supabase/PostgREST sends it as `id=in.()` which
  // returns no rows anyway, but being explicit avoids unexpected behaviour.
  let assignmentsSubmitted = 0;
  let quizzesPublished = 0;

  if (classIds.length > 0) {
    // 5a. Assignment IDs for these classes (cross-tenant safe via class→school)
    const { data: assignmentRows } = await admin
      .from('assignments')
      .select('id')
      .in('class_id', classIds);

    const assignmentIds: string[] =
      (assignmentRows as Array<{ id: string }> | null)?.map(r => r.id) ?? [];

    if (assignmentIds.length > 0) {
      const { count: hwCount } = await admin
        .from('homework_attempts')
        .select('id', { count: 'exact', head: true })
        .in('assignment_id', assignmentIds)
        .gte('submitted_at', weekAgo)
        .neq('status', 'pending');

      assignmentsSubmitted = hwCount ?? 0;
    }

    // 5b. Quizzes published this week
    const { count: quizCount } = await admin
      .from('quizzes')
      .select('id', { count: 'exact', head: true })
      .in('class_id', classIds)
      .gte('published_at', weekAgo);

    quizzesPublished = quizCount ?? 0;
  }

  // 5c. Open alerts — alerts table has school_id directly
  const { count: alertCount } = await admin
    .from('alerts')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('status', 'open');

  // 5d. High-fives sent this week
  const { count: hfCount } = await admin
    .from('high_fives')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .gte('created_at', weekAgo);

  // ── Compose result ───────────────────────────────────────────────────────
  const licenseRow = licRow as {
    tier: string;
    status: string;
    student_limit: number;
    trial_ends_at: string | null;
  } | null;

  return {
    schoolName: (schoolRow as { name: string } | null)?.name ?? '',
    license: {
      tier: licenseRow?.tier ?? null,
      status: licenseRow?.status ?? null,
      studentLimit: licenseRow?.student_limit ?? null,
      trialEndsAt: licenseRow?.trial_ends_at ?? null,
    },
    seatsUsed: studentCount ?? 0,
    counts: {
      students: studentCount ?? 0,
      teachers: teacherCount ?? 0,
      classes: classCount,
    },
    thisWeek: {
      assignmentsSubmitted,
      quizzesPublished,
      openAlerts: alertCount ?? 0,
      highFives: hfCount ?? 0,
    },
  };
}
