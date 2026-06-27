// GET /api/teacher/chapter-tests/[chapterTestId]/students/[studentId]
// Per-student question preview: sections with per-student questions grouped under each section.
//
// Auth chain: createServerSupabaseClient() → auth.getUser() → STAFF_ROLES →
//   load chapter_tests row → guardClassAccess(chapter_tests.class_id) → admin client.
// RLS is NOT the IDOR backstop; guardClassAccess is.
// Teacher surface only — students never call this route.
//
// Returns sections with empty questions[] (NOT 404) when generation is not yet complete
// for the given student. This allows the teacher UI to poll and show progress.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardClassAccess } from '@/lib/auth/guards';

export const runtime = 'nodejs';

type Params = { params: Promise<{ chapterTestId: string; studentId: string }> };

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { chapterTestId, studentId } = await params;

  // ── Auth ────────────────────────────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single();
  if (!STAFF_ROLES.includes(profile?.role as typeof STAFF_ROLES[number])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── Load chapter_tests row → IDOR guard ─────────────────────────────────────
  const admin = createAdminSupabaseClient();
  const { data: testRowRaw, error: testError } = await admin
    .from('chapter_tests')
    .select('class_id')
    .eq('id', chapterTestId)
    .maybeSingle();

  if (testError || !testRowRaw) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const testRow = testRowRaw as { class_id: string };

  const denied = await guardClassAccess(testRow.class_id);
  if (denied) return denied;

  // ── Load sections ordered by section_order ──────────────────────────────────
  const { data: sectionRowsRaw, error: sectionsError } = await admin
    .from('chapter_test_sections')
    .select('id, section_order, section_kind, title')
    .eq('chapter_test_id', chapterTestId)
    .order('section_order');

  if (sectionsError) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }

  const sections = (sectionRowsRaw ?? []) as Array<{
    id: string;
    section_order: number;
    section_kind: string;
    title: string;
  }>;

  const sectionIds = sections.map((s) => s.id);

  // ── Load this student's questions (empty array when none yet — not 404) ─────
  type QuestionRow = {
    id: string;
    section_id: string;
    question_order: number;
    question_type: string;
    question_text: string;
    payload: Record<string, unknown>;
    points: number;
  };

  let questionRows: QuestionRow[] = [];

  if (sectionIds.length > 0) {
    const { data: qRowsRaw } = await admin
      .from('chapter_test_questions')
      .select('id, section_id, question_order, question_type, question_text, payload, points')
      .in('section_id', sectionIds)
      .eq('student_id', studentId)
      .order('question_order');

    questionRows = (qRowsRaw ?? []) as QuestionRow[];
  }

  // ── Group questions under their section ──────────────────────────────────────
  const questionsBySectionId = new Map<string, QuestionRow[]>();
  for (const question of questionRows) {
    const bucket = questionsBySectionId.get(question.section_id) ?? [];
    bucket.push(question);
    questionsBySectionId.set(question.section_id, bucket);
  }

  // ── Build response ───────────────────────────────────────────────────────────
  const result = sections.map((section) => ({
    section_order: section.section_order,
    section_kind: section.section_kind,
    title: section.title,
    questions: (questionsBySectionId.get(section.id) ?? []).map((q) => ({
      id: q.id,
      question_order: q.question_order,
      question_type: q.question_type,
      question_text: q.question_text,
      payload: q.payload,
      points: q.points,
    })),
  }));

  return NextResponse.json({ sections: result });
}
