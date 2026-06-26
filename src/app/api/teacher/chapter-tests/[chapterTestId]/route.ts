// GET /api/teacher/chapter-tests/[chapterTestId] — poll generation_status + per-section question counts
//
// Auth chain: createServerSupabaseClient() → auth.getUser() → STAFF_ROLES →
//   load chapter_tests row → guardClassAccess(chapter_tests.class_id) → admin client.
// RLS is NOT the IDOR backstop; guardClassAccess is.
// Teacher surface only — per-studentId question counts are never exposed to students.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardClassAccess } from '@/lib/auth/guards';

export const runtime = 'nodejs';

type Params = { params: Promise<{ chapterTestId: string }> };

type ResolvedTest = {
  ok: true;
  classId: string;
  generationStatus: string;
  status: string;
  totalMinutes: number;
  totalPoints: number;
};

// ── Shared auth + IDOR resolution ─────────────────────────────────────────────
async function resolveChapterTest(chapterTestId: string): Promise<
  | { ok: false; response: NextResponse }
  | ResolvedTest
> {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single();
  if (!STAFF_ROLES.includes(profile?.role as typeof STAFF_ROLES[number])) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  const admin = createAdminSupabaseClient();
  const { data: testRowRaw, error: testError } = await admin
    .from('chapter_tests')
    .select('class_id, generation_status, status, total_minutes, total_points')
    .eq('id', chapterTestId)
    .maybeSingle();

  if (testError || !testRowRaw) {
    return { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }

  const testRow = testRowRaw as {
    class_id: string;
    generation_status: string;
    status: string;
    total_minutes: number;
    total_points: number;
  };

  const denied = await guardClassAccess(testRow.class_id);
  if (denied) return { ok: false, response: denied };

  return {
    ok: true,
    classId: testRow.class_id,
    generationStatus: testRow.generation_status,
    status: testRow.status,
    totalMinutes: testRow.total_minutes,
    totalPoints: testRow.total_points,
  };
}

// ── GET /api/teacher/chapter-tests/[chapterTestId] ────────────────────────────
// Response: { generation_status, status, total_minutes, total_points, sections }
// sections[].question_counts: { total: number, [studentId]: number }
//   total = count of distinct students with any question in that section
//   [studentId] = count of questions for that student in that section
export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { chapterTestId } = await params;
  const resolved = await resolveChapterTest(chapterTestId);
  if (!resolved.ok) return resolved.response;

  const admin = createAdminSupabaseClient();

  // Load sections ordered by section_order
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

  // Load question counts per (section_id, student_id)
  let questionRows: Array<{ section_id: string; student_id: string }> = [];
  const sectionIds = sections.map((s) => s.id);

  if (sectionIds.length > 0) {
    const { data: qRowsRaw } = await admin
      .from('chapter_test_questions')
      .select('section_id, student_id')
      .in('section_id', sectionIds);
    questionRows = (qRowsRaw ?? []) as Array<{ section_id: string; student_id: string }>;
  }

  // Group question rows: Map<section_id, Map<student_id, count>>
  const questionsBySectionId = new Map<string, Map<string, number>>();
  for (const q of questionRows) {
    let studentMap = questionsBySectionId.get(q.section_id);
    if (!studentMap) {
      studentMap = new Map<string, number>();
      questionsBySectionId.set(q.section_id, studentMap);
    }
    studentMap.set(q.student_id, (studentMap.get(q.student_id) ?? 0) + 1);
  }

  // Build the sections response array
  const sectionsResponse = sections.map((section) => {
    const studentMap = questionsBySectionId.get(section.id) ?? new Map<string, number>();
    const question_counts: Record<string, number> = {
      total: studentMap.size, // distinct student count
    };
    for (const [studentId, count] of studentMap) {
      question_counts[studentId] = count;
    }
    return {
      section_order: section.section_order,
      section_kind: section.section_kind,
      title: section.title,
      question_counts,
    };
  });

  return NextResponse.json({
    generation_status: resolved.generationStatus,
    status: resolved.status,
    total_minutes: resolved.totalMinutes,
    total_points: resolved.totalPoints,
    sections: sectionsResponse,
  });
}
