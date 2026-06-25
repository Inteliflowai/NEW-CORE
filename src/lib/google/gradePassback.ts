// src/lib/google/gradePassback.ts
// Engine: push DRAFT grades from CORE → Google Classroom for a published assignment courseWork.
//
// LESSON-KEYED (C1): the caller passes a lesson_id (the assignment "column"), NOT a single
// assignment row id. Multiple per-student assignment rows may exist for the same lesson in the
// same class (e.g. re-issued work). We collect ALL their graded attempts, deduplicate to the
// LATEST graded attempt per student (attempt_no desc, graded_at desc — mirrors loadGradebook),
// and push one draftGrade per student.
//
// not_posted_in_classroom (C4): when listStudentSubmissions returns an EMPTY list but graded
// students exist, the courseWork was not yet posted (still DRAFT). This is DISTINCT from a
// graded student whose GC submission simply isn't found → that is skipped_not_linked. Never
// mis-bucket everyone as "not linked" when the courseWork hasn't been posted.
//
// Retry (I1): each per-student PATCH is wrapped in a [1s,3s] retry (3 total attempts). A
// GoogleScopeError is NOT transient → re-throw immediately (route maps via gcErrorResponse).
//
// I2 — resolveExternalIdentity(email:null) is correct: every GC-sourced external_identities row
// is written with a non-null external_id = the Google userId by linkOrCreateStudent.writeIdentity
// (on conflict (school_id, provider, external_id)). Since passback resolves a GC submission's
// userId (always present) directly, the email fallback is never needed.
//
// M1 (clamp + scale): draftGrade = round(clamp(grade,0,100)/100 * maxPoints * 10) / 10.
// teacher_score is a free override and can exceed 100 or be negative — clamp before scaling.
import type { SupabaseClient } from '@supabase/supabase-js';
import { listStudentSubmissions, patchStudentSubmissionDraftGrade, GoogleScopeError } from '@/lib/google/classroom';
import { resolveExternalIdentity } from '@/lib/google/resolveExternalIdentity';

export interface PassbackArgs {
  token: string;
  schoolId: string;
  classId: string;
  lessonId: string;              // C1 — the assignment unit is the LESSON, not a single assignment row
  googleCourseId: string;
  courseWorkId: string;
  maxPoints: number;
}

export interface PassbackResult {
  pushed: number;
  skipped_not_linked: number;       // a graded CORE student with NO resolvable GC submission
  not_posted_in_classroom: boolean; // C4 — the courseWork has ZERO studentSubmissions (still DRAFT / unposted)
  errors: number;
}

// sleep seam — exported as const so tests can override via module-mock or fake timers
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// [1s, 3s] → three total attempts (initial + two retries). See spec §I1.
const RETRY_DELAYS_MS = [1000, 3000];

/**
 * Fail-soft per-student PATCH with [1s,3s] retry.
 * A GoogleScopeError is NOT transient — re-throw immediately so the route surfaces the reconnect CTA.
 */
async function patchWithRetry(
  token: string,
  courseId: string,
  courseWorkId: string,
  submissionId: string,
  draftGrade: number,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await patchStudentSubmissionDraftGrade(token, courseId, courseWorkId, submissionId, draftGrade);
      return;
    } catch (err) {
      // GoogleScopeError = token scope is insufficient → reconnect required, NOT transient
      if (err instanceof GoogleScopeError) throw err;
      // Exhausted [1s, 3s] — two retries after the initial attempt
      if (attempt >= RETRY_DELAYS_MS.length) throw err;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

export async function gradePassback(admin: SupabaseClient, args: PassbackArgs): Promise<PassbackResult> {
  const r: PassbackResult = { pushed: 0, skipped_not_linked: 0, not_posted_in_classroom: false, errors: 0 };

  // 1. Collect all assignment rows for this lesson in this class (C1 — lesson is the column).
  const { data: asg } = await admin
    .from('assignments')
    .select('id')
    .eq('class_id', args.classId)
    .eq('lesson_id', args.lessonId);
  const assignmentIds = ((asg ?? []) as Array<{ id: string }>).map((a) => a.id);
  if (assignmentIds.length === 0) return r; // nothing assigned for this lesson/class

  // 2. Graded attempts across all those assignment rows → latest graded attempt per student.
  //    override-wins: teacher_score takes precedence over score_pct.
  const { data: attempts } = await admin
    .from('homework_attempts')
    .select('student_id, score_pct, teacher_score, graded_at, attempt_no')
    .in('assignment_id', assignmentIds)
    .eq('status', 'graded');

  type AttemptRow = {
    student_id: string;
    score_pct: number | null;
    teacher_score: number | null;
    graded_at: string | null;
    attempt_no: number | null;
  };

  // Latest graded attempt per student (attempt_no desc, then graded_at desc) — mirrors loadGradebook.
  const bestByStudent = new Map<string, { grade: number }>();
  const seen = new Map<string, { attempt_no: number; graded_at: string }>();

  for (const a of (attempts ?? []) as AttemptRow[]) {
    // teacher_score is the override; fall back to score_pct
    const g = typeof a.teacher_score === 'number' ? a.teacher_score : a.score_pct;
    if (g == null) continue;

    const cur = seen.get(a.student_id);
    const cand = { attempt_no: a.attempt_no ?? 0, graded_at: a.graded_at ?? '' };
    const wins =
      !cur ||
      cand.attempt_no > cur.attempt_no ||
      (cand.attempt_no === cur.attempt_no && cand.graded_at.localeCompare(cur.graded_at) > 0);

    if (wins) {
      seen.set(a.student_id, cand);
      bestByStudent.set(a.student_id, { grade: g });
    }
  }

  // 3. GC submissions for the courseWork.
  //    EMPTY ⇒ the courseWork hasn't been posted yet (DRAFT or unposted).
  //    Surface a DISTINCT not_posted_in_classroom flag (C4) — do NOT mis-bucket graded students
  //    as skipped_not_linked just because GC returned an empty list.
  const submissions = await listStudentSubmissions(args.token, args.googleCourseId, args.courseWorkId);
  if (submissions.length === 0) {
    r.not_posted_in_classroom = true;
    return r;
  }

  // 4. Resolve each GC userId → CORE student id.
  //    email:null is intentional (I2): GC-sourced external_identities rows always have a non-null
  //    external_id (the Google userId); the email fallback is not needed here.
  const submissionByStudent = new Map<string, string>(); // coreStudentId → submissionId
  for (const sub of submissions) {
    if (!sub.userId) continue;
    const coreId = await resolveExternalIdentity(admin, {
      schoolId: args.schoolId,
      provider: 'google',
      externalId: sub.userId,
      email: null,
    });
    if (coreId) submissionByStudent.set(coreId, sub.id);
  }

  // 5. For each graded CORE student: push draftGrade if they have a GC submission; else skip.
  //    (b1) graded student whose submission is NOT found → skipped_not_linked.
  //    (b2) a GC submission that resolves to a student with no grade → ignored (neither pushed nor skipped).
  for (const [studentId, { grade }] of bestByStudent) {
    const submissionId = submissionByStudent.get(studentId);
    if (!submissionId) {
      // graded in CORE but no GC submission found (student not yet submitted or roster mismatch)
      r.skipped_not_linked++;
      continue;
    }

    // M1: clamp grade to [0, 100] before scaling (teacher_score can exceed 100 or be negative).
    const clamped = Math.min(100, Math.max(0, grade));
    const draftGrade = Math.round((clamped / 100) * args.maxPoints * 10) / 10;

    try {
      await patchWithRetry(args.token, args.googleCourseId, args.courseWorkId, submissionId, draftGrade);
      r.pushed++;
    } catch (err) {
      // GoogleScopeError propagates immediately — the route maps it via gcErrorResponse (reconnect CTA)
      if (err instanceof GoogleScopeError) throw err;
      // Any other error after all retries: count as non-fatal, continue to the next student
      r.errors++;
      console.error('[gc] draftGrade patch failed (non-fatal):', err instanceof Error ? err.message : 'unknown');
    }
  }

  return r;
}
