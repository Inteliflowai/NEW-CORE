// ============================================================
// src/app/api/attempts/[attemptId]/signal/route.ts
// POST /api/attempts/[attemptId]/signal
//
// Liveness heartbeat + behavioral capture for an in-progress quiz attempt.
//
// Auth chain (V2 pattern):
//   createServerSupabaseClient() → auth.getUser() → 401 if no user
//   createAdminSupabaseClient()  — bypasses RLS; ownership is the IDOR
//   backstop (attempt loaded via .eq('student_id', user.id)).
//
// Response shapes:
//   401  no user
//   404  attempt not found / not owned by this student
//   400  attempt already complete
//   200  { ok:true, heartbeat_only:true }  — heartbeat with no responses
//   200  { ok:true }                       — responses upserted
//
// V2 note: V1's signal_events table does not exist in V2.
//          The per-question quiz_responses behavioral columns +
//          quiz_attempts.session_aggregates (jsonb, added in 0014) ARE
//          the signal inputs — no event-log write here.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';

// ── Behavioral response shape from the client ─────────────────────────────────

interface ResponseSignal {
  question_id: string;
  position: number;
  response_text?: string;
  // Behavioral columns — all present in 0003 + 0013 migrations
  response_time_ms?: number;
  hesitation_ms?: number;
  answer_changes?: number;
  navigation_backs?: number;
  pause_count?: number;
  total_pause_ms?: number;
  word_count?: number;
  focus_loss_count?: number;   // added in 0013
  paste_count?: number;        // added in 0013
  hints_used?: number;         // added in 0013
  question_type_scored?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ attemptId: string }> },
): Promise<NextResponse> {
  try {
    // ── 1. Auth ───────────────────────────────────────────────────────────────
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // ── 2. Async params (Next.js 16 requirement) ──────────────────────────────
    const { attemptId } = await params;

    const admin = createAdminSupabaseClient();

    // ── 3. Ownership guard (IDOR backstop) ────────────────────────────────────
    // Load attempt scoped to this student — 404 if absent (wrong student or
    // non-existent attempt). Using .single() here is intentional: an attempt
    // ID is a primary key, so zero rows → not this student's attempt.
    const { data: attempt } = await admin
      .from('quiz_attempts')
      .select('id, student_id, quiz_id, is_complete')
      .eq('id', attemptId)
      .eq('student_id', user.id)
      .single();

    if (!attempt) {
      return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
    }

    type AttemptRow = { id: string; student_id: string; quiz_id: string; is_complete: boolean };
    const row = attempt as AttemptRow;

    if (row.is_complete) {
      return NextResponse.json({ error: 'Attempt already submitted' }, { status: 400 });
    }

    // ── 4. Parse body ─────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({})) as {
      responses?: ResponseSignal[];
      sessionAggregates?: Record<string, unknown>;
    };

    const responses: ResponseSignal[] = body.responses ?? [];
    const sessionAggregates = body.sessionAggregates;

    // ── 5. Always bump liveness (best-effort — non-blocking) ─────────────────
    // Every /signal call from the active quiz page proves the tab is alive.
    // Used by classifyAttemptState to distinguish active / closure-forfeit.
    const livenessPatch: Record<string, unknown> = {
      last_active_at: new Date().toISOString(),
    };

    // Fold sessionAggregates into the same update when present, avoiding
    // two separate round-trips to quiz_attempts.
    if (sessionAggregates !== undefined) {
      livenessPatch['session_aggregates'] = sessionAggregates;
    }

    try {
      await admin
        .from('quiz_attempts')
        .update(livenessPatch)
        .eq('id', attemptId);
    } catch (err) {
      console.warn('[signal] failed to bump liveness / session_aggregates', err);
    }

    // ── 6. Heartbeat-only path ────────────────────────────────────────────────
    // Empty responses array (or omitted) → liveness already bumped above.
    // Return early — no quiz_responses write.
    if (responses.length === 0) {
      return NextResponse.json({ ok: true, heartbeat_only: true });
    }

    // ── 7. Upsert behavioral responses ───────────────────────────────────────
    // onConflict: 'attempt_id,question_id' matches the UNIQUE constraint added
    // in 0013 (quiz_responses_attempt_question_unique).
    const upsertRows = responses.map((r) => ({
      attempt_id: attemptId,
      question_id: r.question_id,
      position: r.position,
      response_text: r.response_text ?? null,
      // Behavioral columns — all confirmed present in migrations 0003 + 0013
      response_time_ms: r.response_time_ms ?? 0,
      hesitation_ms: r.hesitation_ms ?? 0,
      answer_changes: r.answer_changes ?? 0,
      navigation_backs: r.navigation_backs ?? 0,
      pause_count: r.pause_count ?? 0,
      total_pause_ms: r.total_pause_ms ?? 0,
      word_count: r.word_count ?? 0,
      focus_loss_count: r.focus_loss_count ?? 0,
      paste_count: r.paste_count ?? 0,
      hints_used: r.hints_used ?? 0,
      question_type_scored: r.question_type_scored ?? null,
    }));

    const { error: upsertError } = await admin
      .from('quiz_responses')
      .upsert(upsertRows, { onConflict: 'attempt_id,question_id' });

    if (upsertError) {
      console.error('[signal] quiz_responses upsert failed', upsertError);
      return NextResponse.json({ error: 'Failed to save responses' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[signal]', err);
    return NextResponse.json({ error: 'Internal server error: ' + String(err) }, { status: 500 });
  }
}
