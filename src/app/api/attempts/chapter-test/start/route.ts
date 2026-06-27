// src/app/api/attempts/chapter-test/start/route.ts
// POST — create or resume a chapter test attempt for a student.
//
// Auth chain:
//   createServerSupabaseClient() → auth.getUser() → 401 if no user
//   admin.from('users').select('role')    → 403 if not student
//   admin client (service-role) — bypasses RLS; ownership is the IDOR backstop
//     (enrollment check scopes access to enrolled students only).
//
// Algorithm:
//   1. Auth (user must exist AND have role='student')
//   2. Load chapter_tests row — 404 if not found or not published; 409 if not ready
//   3. Verify student is enrolled in chapter_tests.class_id — 403 if not
//   4. Load chapter_test_sections (ordered by section_order)
//   5. Load this student's chapter_test_questions — 404 if none (generation incomplete)
//   6. Upsert attempt (SELECT → INSERT or UPDATE last_active_at)
//   7. Auto-forfeit check: status='in_progress' && elapsed >= 44 min → forfeit
//   8. Load existing responses (for resume)
//   9. Return full response (sections+questions+responses)

import { NextResponse, after } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { gradeChapterAttempt } from '@/lib/chapters/gradeChapterTest';

/** Seconds before an in-progress attempt is auto-forfeited on next start call. */
const FORFEIT_SECONDS = 44 * 60;

/**
 * Strip answer-key / grading material from a question payload before it is sent
 * to the student. SECURITY (C1): the raw payload contains correct_answer (mcq),
 * pairs (matching), and rubric / expected_signals / sample_answer (open types) —
 * a student could read DevTools and score 100% trivially. Whitelist display-safe
 * fields per question_type; deny the grading material for the open types.
 */
function sanitizePayload(
  questionType: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  switch (questionType) {
    case 'mcq': {
      // Keep the choices' labels + display text only — drop correct_answer / rationale.
      const choices = (payload.choices as { label: string; text: string }[] | undefined) ?? [];
      return { choices: choices.map((c) => ({ label: c.label, text: c.text })) };
    }
    case 'matching': {
      // Keep the left/right item arrays — drop pairs (the correct-answer map).
      return { left: payload.left ?? [], right: payload.right ?? [] };
    }
    default: {
      // Open types (short_answer, mini_essay, multi_step_problem, data_interpretation,
      // compare_contrast): keep prompt/context/passage/mermaid, drop grading material.
      const SENSITIVE = new Set([
        'rubric',
        'expected_signals',
        'sample_answer',
        'correct_answer',
        'pairs',
        'rationale',
      ]);
      const safe: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(payload)) {
        if (!SENSITIVE.has(key)) safe[key] = value;
      }
      return safe;
    }
  }
}

type ChapterTestRow = {
  id: string;
  class_id: string;
  status: string;
  generation_status: string;
  total_minutes: number;
  total_points: number;
};

type SectionRow = {
  id: string;
  section_order: number;
  section_kind: string;
  title: string;
  time_minutes: number;
  total_points: number;
  power_skill: string | null;
};

type QuestionRow = {
  id: string;
  section_id: string;
  question_order: number;
  question_type: string;
  question_text: string;
  payload: Record<string, unknown>;
  points: number;
};

type AttemptRow = {
  id: string;
  status: string;
  started_at: string;
  last_active_at: string;
};

type ResponseRow = {
  question_id: string;
  response_text: string | null;
  response_payload: Record<string, unknown> | null;
};

export async function POST(req: Request): Promise<NextResponse> {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // ── 2. Parse body ──────────────────────────────────────────────────────────
  let body: { chapterTestId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  const { chapterTestId } = body;
  if (!chapterTestId) return NextResponse.json({ error: 'Missing chapterTestId' }, { status: 400 });

  const admin = createAdminSupabaseClient();

  // ── 3. Role check: student only ────────────────────────────────────────────
  const { data: userRow } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if ((userRow as { role?: string } | null)?.role !== 'student') {
    return NextResponse.json({ error: 'Forbidden: student access only' }, { status: 403 });
  }

  // ── 4. Load chapter test ───────────────────────────────────────────────────
  const { data: ctData } = await admin
    .from('chapter_tests')
    .select('id, class_id, status, generation_status, total_minutes, total_points')
    .eq('id', chapterTestId)
    .maybeSingle();
  const chapterTest = ctData as ChapterTestRow | null;

  if (!chapterTest) {
    return NextResponse.json({ error: 'Chapter test not found' }, { status: 404 });
  }
  if (chapterTest.status !== 'published') {
    return NextResponse.json({ error: 'Chapter test is not available' }, { status: 404 });
  }
  if (chapterTest.generation_status !== 'ready') {
    return NextResponse.json({ error: 'Test questions are still being generated. Please try again shortly.' }, { status: 409 });
  }

  // ── 5. Verify enrollment ───────────────────────────────────────────────────
  const { data: enrollmentData } = await admin
    .from('enrollments')
    .select('id')
    .eq('class_id', chapterTest.class_id)
    .eq('student_id', user.id)
    .eq('is_active', true)
    .maybeSingle();

  if (!enrollmentData) {
    return NextResponse.json({ error: 'Not enrolled in this class' }, { status: 403 });
  }

  // ── 6. Load sections ───────────────────────────────────────────────────────
  const { data: sectionsRaw } = await admin
    .from('chapter_test_sections')
    .select('id, section_order, section_kind, title, time_minutes, total_points, power_skill')
    .eq('chapter_test_id', chapterTestId)
    .order('section_order');
  const sections = (sectionsRaw as SectionRow[] | null) ?? [];
  const sectionIds = sections.map(s => s.id);

  // ── 7. Load this student's questions ──────────────────────────────────────
  const { data: questionsRaw } = await admin
    .from('chapter_test_questions')
    .select('id, section_id, question_order, question_type, question_text, payload, points')
    .eq('student_id', user.id)
    .in('section_id', sectionIds)
    .order('question_order');
  const questions = (questionsRaw as QuestionRow[] | null) ?? [];

  if (questions.length === 0) {
    return NextResponse.json({ error: 'Questions not ready for your account' }, { status: 404 });
  }

  // ── 8. Upsert attempt (SELECT → INSERT or UPDATE) ─────────────────────────
  const { data: existingRaw } = await admin
    .from('chapter_test_attempts')
    .select('id, status, started_at, last_active_at')
    .eq('chapter_test_id', chapterTestId)
    .eq('student_id', user.id)
    .maybeSingle();
  const existing = existingRaw as AttemptRow | null;

  const now = new Date().toISOString();
  let attempt: AttemptRow;

  if (!existing) {
    // ── INSERT new attempt ─────────────────────────────────────────────────
    const { data: inserted } = await admin
      .from('chapter_test_attempts')
      .insert({
        chapter_test_id: chapterTestId,
        student_id: user.id,
        status: 'in_progress',
        started_at: now,
        last_active_at: now,
      })
      .select()
      .single();
    attempt = inserted as AttemptRow;
  } else {
    // ── 9. Auto-forfeit check ────────────────────────────────────────────────
    const elapsedMs = Date.now() - new Date(existing.started_at).getTime();
    const elapsedSeconds = Math.floor(elapsedMs / 1000);

    if (existing.status === 'in_progress' && elapsedSeconds >= FORFEIT_SECONDS) {
      // Time's up — forfeit this attempt
      await admin
        .from('chapter_test_attempts')
        .update({ status: 'submitted', submitted_at: now, forfeit_reason: 'time_up' })
        .eq('id', existing.id)
        .eq('student_id', user.id);

      // I1: trigger grading so the result screen doesn't poll "Grading…" forever.
      // Fail-soft — never throw from after() (mirrors the submit route).
      const forfeitedAttemptId = existing.id;
      after(async () => {
        try {
          await gradeChapterAttempt(forfeitedAttemptId, admin);
        } catch (err) {
          console.warn(
            '[chapter-test/start] forfeit gradeChapterAttempt failed (non-fatal):',
            err,
          );
        }
      });

      return NextResponse.json({ forfeited: true, attempt_id: existing.id });
    }

    // ── UPDATE last_active_at (and promote not_started → in_progress) ──────
    if (existing.status === 'in_progress' || existing.status === 'not_started') {
      await admin
        .from('chapter_test_attempts')
        .update({ last_active_at: now, status: 'in_progress' })
        .eq('id', existing.id)
        .eq('student_id', user.id);
    }

    attempt = existing;
  }

  // ── 10. Load existing responses (for resume) ──────────────────────────────
  const { data: responsesRaw } = await admin
    .from('chapter_test_responses')
    .select('question_id, response_text, response_payload')
    .eq('attempt_id', attempt.id);
  const existingResponses = (responsesRaw as ResponseRow[] | null) ?? [];

  // ── 11. Group questions by section ────────────────────────────────────────
  const questionsBySectionId = new Map<string, QuestionRow[]>();
  for (const q of questions) {
    if (!questionsBySectionId.has(q.section_id)) {
      questionsBySectionId.set(q.section_id, []);
    }
    questionsBySectionId.get(q.section_id)!.push(q);
  }

  // ── 12. Compute elapsed seconds ───────────────────────────────────────────
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(attempt.started_at).getTime()) / 1000),
  );

  // ── 13. Build and return response ─────────────────────────────────────────
  return NextResponse.json({
    attempt_id: attempt.id,
    status: attempt.status,
    started_at: attempt.started_at,
    elapsed_seconds: elapsedSeconds,
    sections: sections.map(s => ({
      id: s.id,
      section_order: s.section_order,
      section_kind: s.section_kind,
      title: s.title,
      time_minutes: s.time_minutes,
      total_points: s.total_points,
      power_skill: s.power_skill,
      questions: (questionsBySectionId.get(s.id) ?? []).map(q => ({
        id: q.id,
        question_order: q.question_order,
        question_type: q.question_type,
        question_text: q.question_text,
        payload: sanitizePayload(q.question_type, q.payload as Record<string, unknown>),
        points: q.points,
      })),
    })),
    existing_responses: existingResponses.map(r => ({
      question_id: r.question_id,
      response_text: r.response_text ?? null,
      response_payload: r.response_payload ?? {},
    })),
  });
}
