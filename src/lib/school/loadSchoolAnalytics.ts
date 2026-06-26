// src/lib/school/loadSchoolAnalytics.ts
// Pure analytics loader for the school-admin surface.  Caller is responsible
// for auth (resolveAdminContext + createAdminSupabaseClient — RLS bypass; NEVER
// use this with an authed user client). All queries are scoped to schoolId via
// the class→school two-step; cross-tenant safety is enforced by the explicit
// .eq('school_id', schoolId) on schools/users, and .in('class_id', classIds)
// on every other table.
//
// AGGREGATE ONLY — no per-student rows ever leave this loader. The three
// sections are: time-series weekly counts, per-class completion summary, and
// two adoption numbers (active teachers + active students).
import type { SupabaseClient } from '@supabase/supabase-js';
import { isoWeekMonday } from '@/lib/dates/isoWeekMonday';

export interface SchoolAnalytics {
  /** Last 8 calendar weeks, oldest→newest.  Always 8 entries. */
  weeks: { weekStart: string; assignmentsSubmitted: number; quizzesPublished: number }[];
  /** One entry per active class in the school.  Empty when no classes. */
  classes: { name: string; completionPct: number; activity: number }[];
  /** Users in this school who had last_active_at within the last 7 days. */
  adoption: { teachersActive: number; studentsActive: number };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the ISO-date strings of the Monday that starts each of the last
 *  8 calendar weeks, sorted oldest first.  Index 7 is always THIS week. */
function buildLast8Mondays(now: Date): string[] {
  const thisMonday = isoWeekMonday(now);
  const weeks: string[] = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(thisMonday + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - i * 7);
    weeks.push(d.toISOString().slice(0, 10));
  }
  return weeks;
}

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loadSchoolAnalytics(
  admin: SupabaseClient,
  schoolId: string,
): Promise<SchoolAnalytics> {
  const now = new Date();
  const weekStarts = buildLast8Mondays(now);
  const eightWeeksAgo = weekStarts[0];
  // The day AFTER this week ends (used as the exclusive upper bound for quizzes).
  const nextWeekDate = new Date(weekStarts[7] + 'T00:00:00Z');
  nextWeekDate.setUTCDate(nextWeekDate.getUTCDate() + 7);
  const nextWeekStart = nextWeekDate.toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const emptyWeeks = weekStarts.map(ws => ({
    weekStart: ws,
    assignmentsSubmitted: 0,
    quizzesPublished: 0,
  }));

  // ── 1. Fetch active classes (id + name) ──────────────────────────────────
  const { data: classRows } = await admin
    .from('classes')
    .select('id, name')
    .eq('school_id', schoolId)
    .eq('is_active', true);

  const classes = (classRows as Array<{ id: string; name: string }> | null) ?? [];
  const classIds = classes.map(c => c.id);
  const classNameMap = new Map(classes.map(c => [c.id, c.name]));

  // ── 2. Adoption: active users in the last 7 days (independent of classes) ─
  const { count: teachersActive } = await admin
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('role', 'teacher')
    .eq('is_active', true)
    .gte('last_active_at', sevenDaysAgo);

  const { count: studentsActive } = await admin
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('role', 'student')
    .eq('is_active', true)
    .gte('last_active_at', sevenDaysAgo);

  const adoption = {
    teachersActive: teachersActive ?? 0,
    studentsActive: studentsActive ?? 0,
  };

  // Guard: skip class-scoped queries when there are no active classes.
  if (classIds.length === 0) {
    return { weeks: emptyWeeks, classes: [], adoption };
  }

  // ── 3. Fetch assignments for these classes (id + class_id) ───────────────
  // Used for both the weekly bucketing and the per-class completion rate.
  const { data: assignmentRows } = await admin
    .from('assignments')
    .select('id, class_id')
    .in('class_id', classIds);

  const assignments =
    (assignmentRows as Array<{ id: string; class_id: string }> | null) ?? [];
  const assignmentIds = assignments.map(a => a.id);
  const assignmentToClass = new Map(assignments.map(a => [a.id, a.class_id]));

  // ── 4. Fetch homework_attempts for these assignments ─────────────────────
  // Used for BOTH weekly submission bucketing and per-class completion ratio.
  type HWRow = {
    assignment_id: string;
    status: string;
    submitted_at: string | null;
    graded_at: string | null;
  };
  let hwAttempts: HWRow[] = [];
  if (assignmentIds.length > 0) {
    const { data: hwRows } = await admin
      .from('homework_attempts')
      .select('assignment_id, status, submitted_at, graded_at')
      .in('assignment_id', assignmentIds);
    hwAttempts = (hwRows as HWRow[] | null) ?? [];
  }

  // ── 5. Fetch quizzes published in the 8-week window ──────────────────────
  const { data: quizRows } = await admin
    .from('quizzes')
    .select('published_at')
    .in('class_id', classIds)
    .gte('published_at', eightWeeksAgo)
    .lt('published_at', nextWeekStart)
    .not('published_at', 'is', null);

  const quizzes = (quizRows as Array<{ published_at: string }> | null) ?? [];

  // ── Compute weekly buckets ────────────────────────────────────────────────
  const weeklyHW = new Map<string, number>(weekStarts.map(ws => [ws, 0]));
  const weeklyQuiz = new Map<string, number>(weekStarts.map(ws => [ws, 0]));

  for (const ha of hwAttempts) {
    if (!ha.submitted_at) continue;
    const ws = isoWeekMonday(new Date(ha.submitted_at));
    if (weeklyHW.has(ws)) weeklyHW.set(ws, (weeklyHW.get(ws) ?? 0) + 1);
  }

  for (const q of quizzes) {
    const ws = isoWeekMonday(new Date(q.published_at));
    if (weeklyQuiz.has(ws)) weeklyQuiz.set(ws, (weeklyQuiz.get(ws) ?? 0) + 1);
  }

  const weeks = weekStarts.map(ws => ({
    weekStart: ws,
    assignmentsSubmitted: weeklyHW.get(ws) ?? 0,
    quizzesPublished: weeklyQuiz.get(ws) ?? 0,
  }));

  // ── Compute per-class metrics ─────────────────────────────────────────────
  // activity    = total attempt rows (any status) — indicates engagement
  // submitted   = rows with a non-null submitted_at
  // graded      = rows with a non-null graded_at OR status === 'graded'
  // completionPct = graded / submitted (0 when no submissions)
  const classActivity = new Map<string, number>();
  const classSubmitted = new Map<string, number>();
  const classGraded = new Map<string, number>();

  for (const ha of hwAttempts) {
    const cid = assignmentToClass.get(ha.assignment_id);
    if (!cid) continue;
    classActivity.set(cid, (classActivity.get(cid) ?? 0) + 1);
    if (ha.submitted_at) {
      classSubmitted.set(cid, (classSubmitted.get(cid) ?? 0) + 1);
    }
    if (ha.graded_at || ha.status === 'graded') {
      classGraded.set(cid, (classGraded.get(cid) ?? 0) + 1);
    }
  }

  const classStats = classIds.map(cid => {
    const submitted = classSubmitted.get(cid) ?? 0;
    const graded = classGraded.get(cid) ?? 0;
    const activity = classActivity.get(cid) ?? 0;
    const completionPct = submitted > 0 ? Math.round((graded / submitted) * 100) : 0;
    return {
      name: classNameMap.get(cid) ?? '',
      completionPct,
      activity,
    };
  });

  return { weeks, classes: classStats, adoption };
}
