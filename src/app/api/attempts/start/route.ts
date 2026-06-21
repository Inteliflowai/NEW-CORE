// ============================================================
// src/app/api/attempts/start/route.ts
// POST /api/attempts/start
//
// Create / resume / lazy-forfeit a quiz attempt.
//
// Auth chain (V2 pattern):
//   createServerSupabaseClient() → auth.getUser() → 401 if no user
//   createAdminSupabaseClient() — bypasses RLS; ownership is the IDOR
//   backstop (all queries scoped to user.id via student_id / enrollments).
//
// Response shapes per state:
//   - 401  no user
//   - 400  missing quiz_id
//   - 404  quiz not found or not published
//   - 403  student not actively enrolled in quiz's class
//   - 400  attempt already complete
//   - 410  { attempt_id, forfeited:true, forfeit_reason, score_pct, mastery_band }
//          — when existing attempt classifies as closure_forfeit or time_up_forfeit
//   - 200  { attempt_id, started_at, state, resumed_after_seconds,
//            closure_forfeit_minutes, resume_banner_threshold_seconds }
//          — when existing attempt is fresh / active / resuming_after_gap
//   - 200  { attempt_id, started_at, state:'active' }
//          — new attempt inserted
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import {
  classifyAttemptState,
  CLOSURE_FORFEIT_MINUTES,
  RESUME_BANNER_THRESHOLD_SECONDS,
} from '@/lib/student/quizAttemptState';
import { forfeitAttempt } from '@/lib/quiz/forfeitAttempt';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // ── 1. Auth ───────────────────────────────────────────────────────────────
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // ── 2. Parse body ─────────────────────────────────────────────────────────
    const body = await req.json() as Record<string, unknown>;
    const quiz_id = body.quiz_id as string | undefined;
    if (!quiz_id) {
      return NextResponse.json({ error: 'Missing quiz_id' }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();

    // ── 3. Quiz published guard ───────────────────────────────────────────────
    const { data: quiz } = await admin
      .from('quizzes')
      .select('id, class_id, status')
      .eq('id', quiz_id)
      .eq('status', 'published')
      .single();

    if (!quiz) {
      return NextResponse.json({ error: 'Quiz not found or not published' }, { status: 404 });
    }

    const quizRow = quiz as { id: string; class_id: string; status: string };

    // ── 4. Enrollment guard (IDOR backstop) ──────────────────────────────────
    const { data: enrollment } = await admin
      .from('enrollments')
      .select('id')
      .eq('class_id', quizRow.class_id)
      .eq('student_id', user.id)
      .eq('is_active', true)
      .single();

    if (!enrollment) {
      return NextResponse.json({ error: 'Student not enrolled in this class' }, { status: 403 });
    }

    // ── 5. Find most-recent existing attempt for this quiz + student ──────────
    // ORDER + LIMIT ensures deterministic resolution when multiple incomplete
    // rows exist (no unique constraint on quiz_id + student_id).
    const { data: existing } = await admin
      .from('quiz_attempts')
      .select('id, is_complete, started_at, last_active_at, forfeit_reason, score_pct, mastery_band')
      .eq('quiz_id', quiz_id)
      .eq('student_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    type ExistingAttempt = {
      id: string;
      is_complete: boolean;
      started_at: string | null;
      last_active_at: string | null;
      forfeit_reason: 'closure' | 'time_up' | null;
      score_pct: number | null;
      mastery_band: string | null;
    };

    // ── 5a. Already complete → 400 ────────────────────────────────────────────
    if (existing && (existing as ExistingAttempt).is_complete) {
      return NextResponse.json({ error: 'Quiz already completed' }, { status: 400 });
    }

    // ── 5b. In-progress attempt exists → classify + branch ───────────────────
    if (existing && !(existing as ExistingAttempt).is_complete) {
      const row = existing as ExistingAttempt;
      const policyNow = new Date();

      const state = classifyAttemptState({
        isComplete: false,
        forfeitReason: row.forfeit_reason ?? null,
        startedAt: row.started_at ?? null,
        lastActiveAt: row.last_active_at ?? null,
        now: policyNow,
      });

      // Lazy-forfeit: closure or time expired → commit the forfeit, return 410
      if (state === 'closure_forfeit' || state === 'time_up_forfeit') {
        const reason = state === 'closure_forfeit' ? 'closure' : 'time_up';
        const result = await forfeitAttempt({ admin, attemptId: row.id, reason });
        if (!result.ok) {
          return NextResponse.json({ error: result.error }, { status: 500 });
        }
        return NextResponse.json(
          {
            attempt_id: row.id,
            forfeited: true,
            forfeit_reason: reason,
            score_pct: result.scorePct,
            mastery_band: result.masteryBand,
          },
          { status: 410 },
        );
      }

      // Fresh: teacher-granted row, wall-clock hasn't started yet.
      // Stamp started_at so the timer begins on this first touch.
      // After stamping, the attempt IS active — emit state:'active' to the client.
      let effectiveStartedAt: string | null = row.started_at ?? null;
      let effectiveState: string = state;
      if (state === 'fresh') {
        const nowIso = new Date().toISOString();
        try {
          await admin
            .from('quiz_attempts')
            .update({ started_at: nowIso })
            .eq('id', row.id);
          effectiveStartedAt = nowIso;
        } catch (err) {
          // non-blocking — client uses the stamped value if successful
          console.warn('[start] failed to stamp started_at', err);
        }
        // Normalise: fresh-start becomes 'active' from the client's perspective
        effectiveState = 'active';
      }

      // active / resuming_after_gap → resume.
      // Surface gap seconds so the client can render the recovery banner.
      let resumed_after_seconds: number | null = null;
      if (state === 'resuming_after_gap' && row.last_active_at) {
        resumed_after_seconds = Math.floor(
          (policyNow.getTime() - new Date(row.last_active_at).getTime()) / 1000,
        );
      }

      return NextResponse.json({
        attempt_id: row.id,
        started_at: effectiveStartedAt,
        state: effectiveState,
        resumed_after_seconds,
        closure_forfeit_minutes: CLOSURE_FORFEIT_MINUTES,
        resume_banner_threshold_seconds: RESUME_BANNER_THRESHOLD_SECONDS,
      });
    }

    // ── 6. No existing attempt → insert a fresh one ───────────────────────────
    const nowIso = new Date().toISOString();
    const { data: attempt, error: attemptError } = await admin
      .from('quiz_attempts')
      .insert({
        quiz_id,
        student_id: user.id,
        started_at: nowIso,
        last_active_at: nowIso,
        is_complete: false,
      })
      .select()
      .single();

    if (attemptError || !attempt) {
      throw new Error('Failed to create attempt: ' + (attemptError?.message ?? 'unknown'));
    }

    const newAttempt = attempt as { id: string; started_at: string };

    return NextResponse.json({
      attempt_id: newAttempt.id,
      started_at: newAttempt.started_at,
      state: 'active' as const,
    });
  } catch (err) {
    console.error('[start-attempt]', err);
    return NextResponse.json({ error: 'Internal server error: ' + String(err) }, { status: 500 });
  }
}
