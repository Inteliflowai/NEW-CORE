// src/app/api/attempts/chapter-test/save-response/route.ts
// POST — idempotent per-question autosave for a chapter test attempt.
//
// Auth chain:
//   createServerSupabaseClient() → auth.getUser() → 401 if no user
//   admin.from('users').select('role')           → 403 if not student
//   admin client (service-role) — bypasses RLS; student_id check IS the IDOR backstop
//
// Algorithm:
//   1. Auth (student only)
//   2. Parse body: { attemptId, questionId, response_text?, response_payload? }
//   3. Load attempt → 404 if missing, 403 if wrong student, 409 if not in_progress
//   4. Upsert chapter_test_responses (UNIQUE(attempt_id,question_id) — idempotent)
//   5. Update chapter_test_attempts.last_active_at = now()
//   6. Return { ok: true }

import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';

type AttemptRow = {
  id: string;
  student_id: string;
  status: string;
};

export async function POST(req: Request): Promise<NextResponse> {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminSupabaseClient();

  // ── 2. Role check: student only ────────────────────────────────────────────
  const { data: userRow } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if ((userRow as { role?: string } | null)?.role !== 'student') {
    return NextResponse.json({ error: 'Forbidden: student access only' }, { status: 403 });
  }

  // ── 3. Parse body ──────────────────────────────────────────────────────────
  let body: {
    attemptId?: string;
    questionId?: string;
    response_text?: string;
    response_payload?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const { attemptId, questionId, response_text, response_payload } = body;
  if (!attemptId) return NextResponse.json({ error: 'Missing attemptId' }, { status: 400 });
  if (!questionId) return NextResponse.json({ error: 'Missing questionId' }, { status: 400 });

  // ── 4. Load attempt ────────────────────────────────────────────────────────
  const { data: attemptData } = await admin
    .from('chapter_test_attempts')
    .select('id, student_id, status')
    .eq('id', attemptId)
    .single();
  const attempt = attemptData as AttemptRow | null;

  if (!attempt) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });

  // ── 5. IDOR guard ──────────────────────────────────────────────────────────
  if (attempt.student_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── 6. Status guard ────────────────────────────────────────────────────────
  if (attempt.status !== 'in_progress') {
    return NextResponse.json({ error: 'Test already submitted' }, { status: 409 });
  }

  // ── 7. Upsert response (idempotent) ───────────────────────────────────────
  await admin
    .from('chapter_test_responses')
    .upsert(
      {
        attempt_id: attemptId,
        question_id: questionId,
        response_text: response_text ?? null,
        response_payload: response_payload ?? {},
      },
      { onConflict: 'attempt_id,question_id' },
    );

  // ── 8. Update last_active_at ───────────────────────────────────────────────
  await admin
    .from('chapter_test_attempts')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', attemptId)
    .eq('student_id', user.id);

  // ── 9. Return ok ───────────────────────────────────────────────────────────
  return NextResponse.json({ ok: true });
}
