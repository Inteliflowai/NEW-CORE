// src/app/api/teacher/gradebook/chapter-attempt/route.ts
// GET ?chapterTestId=<id>&studentId=<id>
// On-demand lazy load for the ChapterTestDrillIn panel: per-student section breakdown
// with question text + responses + AI grades. Kept off the main gradebook loader so the
// grid stays light — only fetched when a teacher clicks a graded/submitted cell.
//
// Auth: getUser → STAFF_ROLES gate → chapter_tests.class_id → guardClassAccess (IDOR).
// RLS is NOT the backstop; all reads go through the admin client after the guard.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardClassAccess } from '@/lib/auth/guards';

type SectionRow = {
  id: string;
  section_order: number;
  section_kind: string;
  title: string;
  time_minutes: number;
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

type AttemptRow = {
  id: string;
  status: string;
  total_grade: number | null;
  total_max: number | null;
};

type ResponseRow = {
  question_id: string;
  response_text: string | null;
  response_payload: unknown;
  grade: number | null;
  ai_feedback: string | null;
};

export async function GET(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const chapterTestId = url.searchParams.get('chapterTestId');
  const studentId = url.searchParams.get('studentId');
  if (!chapterTestId || !studentId) {
    return NextResponse.json({ error: 'Missing chapterTestId or studentId' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();

  // Role gate (STAFF_ROLES only — teacher-facing surface)
  const { data: roleRow } = await admin
    .from('users').select('role').eq('id', user.id).maybeSingle();
  const role = (roleRow as { role?: string } | null)?.role;
  if (!role || !new Set<string>(STAFF_ROLES).has(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── Load chapter test (to get class_id for the IDOR guard) ────────────────
  const { data: ctData } = await admin
    .from('chapter_tests').select('id, class_id').eq('id', chapterTestId).maybeSingle();
  const ct = ctData as { id: string; class_id: string } | null;
  if (!ct) return NextResponse.json({ error: 'Chapter test not found' }, { status: 404 });

  // IDOR guard: teacher must own (or be admin of) the class
  const guard = await guardClassAccess(ct.class_id);
  if (guard) return guard;

  // ── Load sections ──────────────────────────────────────────────────────────
  const { data: sectionsData } = await admin
    .from('chapter_test_sections')
    .select('id, section_order, section_kind, title, time_minutes, total_points')
    .eq('chapter_test_id', chapterTestId)
    .order('section_order');
  const sections = (sectionsData ?? []) as SectionRow[];
  const sectionIds = sections.map((s) => s.id);

  // ── Load questions for this student ───────────────────────────────────────
  let questions: QuestionRow[] = [];
  if (sectionIds.length > 0) {
    const { data: qData } = await admin
      .from('chapter_test_questions')
      .select('id, section_id, question_order, question_type, question_text, points')
      .in('section_id', sectionIds)
      .eq('student_id', studentId)
      .order('question_order');
    questions = (qData ?? []) as QuestionRow[];
  }

  // ── Load attempt (single row or null) ─────────────────────────────────────
  const { data: attemptData } = await admin
    .from('chapter_test_attempts')
    .select('id, status, total_grade, total_max')
    .eq('chapter_test_id', chapterTestId)
    .eq('student_id', studentId)
    .maybeSingle();
  const attempt = attemptData as AttemptRow | null;

  // ── Load responses (only when an attempt exists) ──────────────────────────
  let responses: ResponseRow[] = [];
  if (attempt) {
    const { data: rData } = await admin
      .from('chapter_test_responses')
      .select('question_id, response_text, response_payload, grade, ai_feedback')
      .eq('attempt_id', attempt.id);
    responses = (rData ?? []) as ResponseRow[];
  }

  // ── Join responses to questions ────────────────────────────────────────────
  const responseByQuestion = new Map<string, ResponseRow>(
    responses.map((r) => [r.question_id, r]),
  );

  const resultSections = sections.map((section) => ({
    section_order: section.section_order,
    section_kind: section.section_kind,
    title: section.title,
    time_minutes: section.time_minutes,
    total_points: section.total_points,
    questions: questions
      .filter((q) => q.section_id === section.id)
      .map((q) => {
        const r = responseByQuestion.get(q.id);
        return {
          question_order: q.question_order,
          question_type: q.question_type,
          question_text: q.question_text,
          points: q.points,
          response_text: r?.response_text ?? null,
          response_payload: (r?.response_payload ?? null) as Record<string, unknown> | null,
          grade: r?.grade ?? null,
          ai_feedback: r?.ai_feedback ?? null,
        };
      }),
  }));

  return NextResponse.json({
    attempt_id: attempt?.id ?? null,
    status: (attempt?.status ?? 'not_started') as
      | 'not_started'
      | 'in_progress'
      | 'submitted'
      | 'graded',
    total_grade: attempt?.total_grade ?? null,
    total_max: attempt?.total_max ?? null,
    sections: resultSections,
  });
}
