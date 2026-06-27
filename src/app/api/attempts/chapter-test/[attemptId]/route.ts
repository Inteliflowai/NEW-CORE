// src/app/api/attempts/chapter-test/[attemptId]/route.ts
// GET — result polling for a chapter test attempt (student-owned).
//
// Auth chain:
//   createServerSupabaseClient() → auth.getUser() → 401 if no user
//   admin.from('users').select('role')           → 403 if not student
//   admin client (service-role) — bypasses RLS; student_id check IS the IDOR backstop
//
// Algorithm:
//   1. Auth (student only)
//   2. Load attempt → 404 if missing, 403 if wrong student, 403 if still in_progress
//   3. Load sections for the chapter test (ordered by section_order)
//   4. Load this student's questions for those sections (ordered by question_order)
//   5. Load responses for this attempt
//   6. Compute section_grade = sum of response.grade for questions in each section
//      (null when no question in section has been graded)
//   7. Return full result shape (four-audience: students see total_grade as earned grade)
//
// Four-audience: This endpoint is STUDENT-FACING.
//   - total_grade is allowed (summative graded coursework, same as homework)
//   - section_grade is raw number (it IS their earned grade per section)
//   - NO band/CL/risk/diagnostic labels on any string here
//   - ai_feedback is per-question educational feedback only

import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';

type AttemptRow = {
  id: string;
  student_id: string;
  status: string;
  chapter_test_id: string;
  total_grade: number | null;
  total_max: number | null;
  forfeit_reason: string | null;
};

type SectionRow = {
  id: string;
  section_order: number;
  title: string;
  total_points: number;
};

type QuestionRow = {
  id: string;
  section_id: string;
  question_order: number;
  question_type: string;
  question_text: string;
  points: number;
};

type ResponseRow = {
  question_id: string;
  response_text: string | null;
  grade: number | null;
  ai_feedback: string | null;
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ attemptId: string }> },
): Promise<NextResponse> {
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

  // ── 3. Resolve attemptId from dynamic segment ─────────────────────────────
  const { attemptId } = await params;

  // ── 4. Load attempt ────────────────────────────────────────────────────────
  const { data: attemptData } = await admin
    .from('chapter_test_attempts')
    .select('id, student_id, status, chapter_test_id, total_grade, total_max, forfeit_reason')
    .eq('id', attemptId)
    .single();
  const attempt = attemptData as AttemptRow | null;

  if (!attempt) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });

  // ── 5. IDOR guard ──────────────────────────────────────────────────────────
  if (attempt.student_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── 6. Status guard: only submitted or graded are readable via this endpoint
  if (attempt.status === 'in_progress') {
    return NextResponse.json(
      { error: 'Test is still in progress. Use the start endpoint.' },
      { status: 403 },
    );
  }

  // ── 7. Load sections ───────────────────────────────────────────────────────
  const { data: sectionsRaw } = await admin
    .from('chapter_test_sections')
    .select('id, section_order, title, total_points')
    .eq('chapter_test_id', attempt.chapter_test_id)
    .order('section_order');
  const sections = (sectionsRaw as SectionRow[] | null) ?? [];
  const sectionIds = sections.map(s => s.id);

  // ── 8. Load this student's questions for those sections ───────────────────
  const { data: questionsRaw } = await admin
    .from('chapter_test_questions')
    .select('id, section_id, question_order, question_type, question_text, points')
    .eq('student_id', user.id)
    .in('section_id', sectionIds)
    .order('question_order');
  const questions = (questionsRaw as QuestionRow[] | null) ?? [];

  // ── 9. Load responses for this attempt ────────────────────────────────────
  const { data: responsesRaw } = await admin
    .from('chapter_test_responses')
    .select('question_id, response_text, grade, ai_feedback')
    .eq('attempt_id', attempt.id);
  const responses = (responsesRaw as ResponseRow[] | null) ?? [];

  // Build lookup maps
  const responseByQuestionId = new Map<string, ResponseRow>();
  for (const r of responses) {
    responseByQuestionId.set(r.question_id, r);
  }

  const questionsBySectionId = new Map<string, QuestionRow[]>();
  for (const q of questions) {
    if (!questionsBySectionId.has(q.section_id)) {
      questionsBySectionId.set(q.section_id, []);
    }
    questionsBySectionId.get(q.section_id)!.push(q);
  }

  // ── 10. Build section results with computed section_grade ──────────────────
  const sectionResults = sections.map(section => {
    const sectionQuestions = questionsBySectionId.get(section.id) ?? [];

    // section_grade: sum of graded responses for this section's questions;
    // null if no question in this section has a grade yet.
    let sectionGrade: number | null = null;
    for (const q of sectionQuestions) {
      const r = responseByQuestionId.get(q.id);
      if (r?.grade != null) {
        sectionGrade = (sectionGrade ?? 0) + r.grade;
      }
    }

    return {
      section_order: section.section_order,
      title: section.title,
      section_grade: sectionGrade,
      section_max: section.total_points,
      questions: sectionQuestions.map(q => {
        const r = responseByQuestionId.get(q.id) ?? null;
        return {
          question_order: q.question_order,
          question_type: q.question_type,
          question_text: q.question_text,
          points: q.points,
          grade: r?.grade ?? null,
          ai_feedback: r?.ai_feedback ?? null,
          response_text: r?.response_text ?? null,
        };
      }),
    };
  });

  // ── 11. Return result ──────────────────────────────────────────────────────
  return NextResponse.json({
    status: attempt.status,
    total_grade: attempt.total_grade,
    total_max: attempt.total_max,
    forfeit_reason: attempt.forfeit_reason,
    sections: sectionResults,
  });
}
