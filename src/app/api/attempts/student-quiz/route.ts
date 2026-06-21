// ============================================================
// src/app/api/attempts/student-quiz/route.ts
// GET — returns the most recent published quiz for the student's enrolled classes.
//
// Auth chain:
//   createServerSupabaseClient() → auth.getUser() → 401 if no user
//   createAdminSupabaseClient() — bypasses RLS; ownership is the IDOR backstop
//     (all queries scoped to user.id via student_id / class enrollments).
//
// Selection logic (ported from V1 app/api/attempts/student-quiz/route.ts):
//   1. Get student's active enrollments (class_id, enrolled_at).
//   2. Fetch all published quizzes for those classes, newest first.
//   3. Determine which quizzes the student has any/completed attempts for.
//   4. Filter via isQuizAvailableForStudent (5-min in-class window + grant rule).
//   5. Pick the first available quiz; fall back to the most-recent completed
//      eligible quiz so the student lands on review state, not an empty page.
//   6. Surface the most-recent attempt (any state) for the resolved quiz.
//   7. Fetch quiz+questions, class name, teacher name.
//
// Response: { quiz: {…, quiz_questions:[…]} | null, existing_attempt | null,
//             teacher_name: string, class_name: string }
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { isQuizAvailableForStudent } from '@/lib/quiz/isQuizAvailableForStudent';

// UUID guard — rejects the literal string "undefined" that a router.push with
// an unresolved id produces (e.g. `?quizId=${obj.id}` where obj.id was undefined).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    // ── 1. Auth ───────────────────────────────────────────────────────────────
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createAdminSupabaseClient();

    // ── 2. Optional ?quizId= — UUID-guarded ──────────────────────────────────
    const rawQuizId = req.nextUrl.searchParams.get('quizId');
    const quizIdParam = rawQuizId && UUID_RE.test(rawQuizId) ? rawQuizId : null;

    let resolvedQuizId: string | null = null;

    // ── 3a. ?quizId= branch: resolve + eligibility guard (IDOR + draft guard) ──
    // When the caller supplies an explicit quiz ID (e.g. review deep-link from
    // quiz history) we apply two gates:
    //   Gate 1 — published only: drafts are never surfaced to students.
    //   Gate 2 — enrollment (IDOR backstop): student must have an active
    //            enrollment in the quiz's class.
    // We do NOT call isQuizAvailableForStudent here — that helper's in-class
    // window rules would wrongly block a student reviewing a completed quiz.
    // Whether they may start a NEW attempt is enforced downstream at creation.
    if (quizIdParam) {
      // Load the quiz row to discover its class_id and status.
      const { data: quizRow } = await admin
        .from('quizzes')
        .select('id, class_id, status')
        .eq('id', quizIdParam)
        .single();

      if (quizRow) {
        const qr = quizRow as { id: string; class_id: string | null; status: string | null };

        // Gate 1: published only — do not surface draft quizzes to students.
        if (qr.status === 'published') {
          // Gate 2: student must have an active enrollment in the quiz's class.
          const { data: enrollmentRows } = await admin
            .from('enrollments')
            .select('class_id')
            .eq('class_id', qr.class_id ?? '')
            .eq('student_id', user.id)
            .eq('is_active', true);

          const enrolled = (enrollmentRows as unknown[] | null)?.length ?? 0;

          if (enrolled > 0) {
            resolvedQuizId = qr.id;
          }
        }
      }

      // If either gate failed (not published, not enrolled, or quiz not found),
      // return the same "no quiz available" shape — do NOT leak the quiz.
      if (!resolvedQuizId) {
        return NextResponse.json({ quiz: null, existing_attempt: null, teacher_name: '', class_name: '', reason: 'not_eligible' });
      }
    }

    // ── 3b. Selection via enrollments (when no explicit quizId) ─────────────
    if (!resolvedQuizId) {
      const { data: enrollments } = await admin
        .from('enrollments')
        .select('class_id, enrolled_at')
        .eq('student_id', user.id)
        .eq('is_active', true);

      if (!enrollments?.length) {
        return NextResponse.json({ quiz: null, existing_attempt: null, teacher_name: '', class_name: '', reason: 'no_enrollments' });
      }

      const classIds = (enrollments as { class_id: string; enrolled_at: string | null }[]).map(e => e.class_id);
      const enrolledAtByClass = new Map<string, string>(
        (enrollments as { class_id: string; enrolled_at: string | null }[])
          .map(e => [e.class_id, e.enrolled_at ?? new Date(0).toISOString()]),
      );

      // Fetch published quizzes across enrolled classes, newest first.
      const { data: allPublished } = await admin
        .from('quizzes')
        .select('id, class_id, published_at')
        .in('class_id', classIds)
        .eq('status', 'published')
        .order('published_at', { ascending: false });

      if (allPublished?.length) {
        // All attempts (any state) — used to derive started + completed sets.
        const { data: allAttempts } = await admin
          .from('quiz_attempts')
          .select('quiz_id, submitted_at, is_complete')
          .eq('student_id', user.id);

        const completedQuizIds = new Set<string>();
        const startedQuizIds = new Set<string>();
        for (const a of (allAttempts ?? []) as { quiz_id: string; submitted_at: string | null; is_complete: boolean }[]) {
          startedQuizIds.add(a.quiz_id);
          if (a.submitted_at || a.is_complete) completedQuizIds.add(a.quiz_id);
        }

        const policyNow = new Date();

        // Filter through central availability helper.
        const available = (allPublished as { id: string; class_id: string; published_at: string | null }[])
          .filter(q =>
            isQuizAvailableForStudent({
              publishedAt: q.published_at,
              enrolledAt: enrolledAtByClass.get(q.class_id) ?? null,
              hasAnyAttempt: startedQuizIds.has(q.id),
              hasCompletedAttempt: completedQuizIds.has(q.id),
              now: policyNow,
            }),
          );

        resolvedQuizId = available[0]?.id ?? null;

        // Fallback: most-recent completed eligible quiz (student lands on review,
        // not empty). Pre-enrollment + completed quizzes already in-class qualify.
        if (!resolvedQuizId) {
          const completedEligible = (allPublished as { id: string; class_id: string; published_at: string | null }[])
            .filter(q => {
              if (!completedQuizIds.has(q.id)) return false;
              const enrolledAt = enrolledAtByClass.get(q.class_id);
              return q.published_at != null && enrolledAt != null && q.published_at >= enrolledAt;
            });
          resolvedQuizId = completedEligible[0]?.id ?? null;
        }
      }
    }

    if (!resolvedQuizId) {
      return NextResponse.json({ quiz: null, existing_attempt: null, teacher_name: '', class_name: '', reason: 'no_published_quiz' });
    }

    // ── 4. Most-recent attempt for the resolved quiz (any state) ─────────────
    // Needed for wall-clock timer on refresh mid-attempt + forfeit vs review state.
    const { data: latestAttempts } = await admin
      .from('quiz_attempts')
      .select('id, is_complete, score_pct, mastery_band, adapted_questions, started_at, last_active_at, forfeit_reason')
      .eq('quiz_id', resolvedQuizId)
      .eq('student_id', user.id)
      .order('started_at', { ascending: false })
      .limit(1);

    const existingAttempt = (latestAttempts as unknown[])?.[0] ?? null;

    // ── 5. Quiz with questions ────────────────────────────────────────────────
    const { data: quiz } = await admin
      .from('quizzes')
      .select('id, title, class_id, quiz_questions(*)')
      .eq('id', resolvedQuizId)
      .single();

    if (!quiz) {
      return NextResponse.json({ quiz: null, existing_attempt: null, teacher_name: '', class_name: '', reason: 'quiz_not_found' });
    }

    // ── 6. Class name + teacher name (for notification banner) ───────────────
    let className = '';
    let teacherName = '';
    const quizRow = quiz as { class_id?: string | null; [k: string]: unknown };
    if (quizRow.class_id) {
      const { data: cls } = await admin
        .from('classes')
        .select('name, teacher_id')
        .eq('id', quizRow.class_id)
        .single();
      if (cls) {
        const clsRow = cls as { name?: string; teacher_id?: string | null };
        className = clsRow.name ?? '';
        if (clsRow.teacher_id) {
          const { data: teacher } = await admin
            .from('users')
            .select('full_name')
            .eq('id', clsRow.teacher_id)
            .single();
          teacherName = (teacher as { full_name?: string } | null)?.full_name ?? '';
        }
      }
    }

    return NextResponse.json({
      quiz,
      existing_attempt: existingAttempt,
      teacher_name: teacherName,
      class_name: className,
    });
  } catch (err) {
    console.error('[student-quiz]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
