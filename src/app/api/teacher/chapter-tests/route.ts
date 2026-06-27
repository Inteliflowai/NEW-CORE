// POST /api/teacher/chapter-tests — create a chapter test + queue background generation.
//
// Auth chain: createServerSupabaseClient() → auth.getUser() → STAFF_ROLES →
//   load chapters row → guardClassAccess(chapter.class_id) → createAdminSupabaseClient()
// RLS is NOT the IDOR backstop; guardClassAccess is.
//
// Pattern (same as quizzes/generate/route.ts):
//   1. Validate + auth synchronously
//   2. Create chapter_tests row (generation_status='queued') + 5 chapter_test_sections
//   3. Return { chapter_test_id } immediately (200)
//   4. after(): load enrolled students + lesson texts → call generateChapterQuestions
//      On failure: update generation_status='failed' + log. NEVER throw out of after().

import { NextRequest, NextResponse, after } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardClassAccess } from '@/lib/auth/guards';
import { getTemplate, type ChapterTestTemplate } from '@/lib/chapters/chapterTemplates';
import { generateChapterQuestions, type StudentContext } from '@/lib/chapters/generateChapterTest';

export const runtime = 'nodejs';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
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

  // ── 2. Parse body ──────────────────────────────────────────────────────────
  let body: { chapterId?: string; title?: string; template?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  const chapterId = (body.chapterId ?? '').trim();
  const title = (body.title ?? '').trim();
  const template = (body.template ?? 'humanities') as ChapterTestTemplate;

  if (!chapterId) return NextResponse.json({ error: 'chapterId required' }, { status: 400 });
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });
  if (template !== 'humanities' && template !== 'stem') {
    return NextResponse.json({ error: 'Invalid template' }, { status: 400 });
  }

  // ── 3. Load chapter row to get class_id (admin client) ─────────────────────
  const admin = createAdminSupabaseClient();

  const { data: chapterRaw, error: chapterError } = await admin
    .from('chapters')
    .select('id, class_id')
    .eq('id', chapterId)
    .maybeSingle();

  if (chapterError || !chapterRaw) {
    return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
  }

  const chapter = chapterRaw as { id: string; class_id: string };

  // ── 4. Object-level IDOR guard ─────────────────────────────────────────────
  const denied = await guardClassAccess(chapter.class_id);
  if (denied) return denied;

  // ── 5. Create chapter_tests row (status='draft', generation_status='queued') ─
  const templateDef = getTemplate(template);

  const { data: chapterTestRaw, error: testInsertError } = await admin
    .from('chapter_tests')
    .insert({
      chapter_id: chapterId,
      class_id: chapter.class_id,
      teacher_id: user.id,
      title,
      template,
      total_minutes: templateDef.total_minutes,
      total_points: templateDef.total_points,
      generation_status: 'queued',
      status: 'draft',
    })
    .select('id')
    .single();

  if (testInsertError || !chapterTestRaw) {
    return NextResponse.json({ error: 'Failed to create chapter test' }, { status: 500 });
  }

  const chapterTestId = (chapterTestRaw as { id: string }).id;

  // ── 6. Insert 5 chapter_test_sections rows from the locked template ─────────
  const sectionRows = templateDef.sections.map((s) => ({
    chapter_test_id: chapterTestId,
    section_order: s.order,
    section_kind: s.kind,
    title: s.title,
    time_minutes: s.time_minutes,
    total_points: s.total_points,
    power_skill: s.power_skill,
  }));

  const { error: sectionsError } = await admin
    .from('chapter_test_sections')
    .insert(sectionRows);

  if (sectionsError) {
    // Sections failed — mark the test as failed so the teacher knows
    await admin
      .from('chapter_tests')
      .update({ generation_status: 'failed' })
      .eq('id', chapterTestId);
    return NextResponse.json({ error: 'Failed to create test sections' }, { status: 500 });
  }

  // ── 7. Return immediately — teacher is freed ───────────────────────────────
  // Snapshot all data needed inside after() before the response is sent.
  const snapshotClassId = chapter.class_id;
  const snapshotChapterId = chapterId;
  const snapshotTemplate = template;

  after(async () => {
    try {
      // C2: Load enrolled students (active enrollments for this class)
      const { data: enrollmentRows } = await admin
        .from('enrollments')
        .select('student_id')
        .eq('class_id', snapshotClassId)
        .eq('is_active', true);

      const studentIds = ((enrollmentRows ?? []) as Array<{ student_id: string }>)
        .map((e) => e.student_id);

      if (studentIds.length === 0) {
        // No enrolled students — mark failed (no questions to generate)
        await admin
          .from('chapter_tests')
          .update({ generation_status: 'failed' })
          .eq('id', chapterTestId);
        console.error('[chapter-tests] No active enrolled students for class', snapshotClassId);
        return;
      }

      // C2: Best-effort snapshot of comprehension_band + learning_style from
      // behavioral_signals.computed (these fields may be null if not yet computed).
      // The band at generation time is preserved on each chapter_test_questions row.
      const { data: signalRows } = await admin
        .from('behavioral_signals')
        .select('student_id, computed')
        .in('student_id', studentIds);

      const signalMap = new Map<string, { comprehension_band: string | null; learning_style: string | null }>();
      for (const row of ((signalRows ?? []) as Array<{ student_id: string; computed: Record<string, unknown> | null }>)) {
        const computed = row.computed ?? {};
        signalMap.set(row.student_id, {
          comprehension_band: (computed['comprehension_band'] as string | null) ?? null,
          learning_style: (computed['learning_style'] as string | null) ?? null,
        });
      }

      const students: StudentContext[] = studentIds.map((studentId) => {
        const sig = signalMap.get(studentId) ?? { comprehension_band: null, learning_style: null };
        return { studentId, comprehension_band: sig.comprehension_band, learning_style: sig.learning_style };
      });

      // Load lesson texts for the chapter (all lessons assigned to this chapter)
      const { data: lessonRows } = await admin
        .from('lessons')
        .select('parsed_content')
        .eq('chapter_id', snapshotChapterId);

      const lessonTexts = ((lessonRows ?? []) as Array<{ parsed_content: unknown }>)
        .map((l) => JSON.stringify(l.parsed_content));

      // Call the generation engine — it handles its own error states + never throws
      await generateChapterQuestions({
        admin,
        chapterTestId,
        students,
        lessonTexts,
        template: snapshotTemplate,
      });
    } catch (err) {
      // Unexpected top-level failure — mark failed, NEVER throw out of after()
      console.error('[chapter-tests] after() unexpected failure:', err);
      try {
        await admin
          .from('chapter_tests')
          .update({ generation_status: 'failed' })
          .eq('id', chapterTestId);
      } catch (updateErr) {
        console.error('[chapter-tests] Failed to set generation_status=failed:', updateErr);
      }
    }
  });

  return NextResponse.json({ chapter_test_id: chapterTestId });
}
