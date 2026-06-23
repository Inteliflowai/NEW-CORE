// src/app/api/teacher/lessons/generate/route.ts
// POST — generate a lesson (single day or a multi-day unit) from a typed description.
// Auth: getUser → role ∈ TEACHER_ROLES → guardClassAccess (the ONLY IDOR backstop) → admin client.
// Standards-aware: resolves the school's US state (body.state override) → framework → prompt guidance.
// Persists N pending_review lessons (source='generate'); the teacher confirms standards + makes
// quizzes from the review surface. Engine throws LlmExhaustedError → respondEngineError → 503.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardClassAccess } from '@/lib/auth/guards';
import { respondEngineError } from '@/app/api/_lib/errorEnvelope';
import { generateLesson, segmentUnit, resolveNumDays } from '@/lib/engine/lessonGenerate';
import { standardsGuidance, frameworkShortLabelForState, isUsStateCode } from '@/lib/standards/frameworks';

const TEACHER_ROLES = new Set(['teacher', 'school_admin', 'school_sysadmin', 'platform_admin']);

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createAdminSupabaseClient();
    const { data: profile } = await admin.from('users').select('role').eq('id', user.id).single();
    const role: string | null = (profile as { role?: string } | null)?.role ?? null;
    if (!role || !TEACHER_ROLES.has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = (await req.json().catch(() => null)) as
      | { description?: string; class_id?: string; subject?: string; grade_level?: string; num_days?: number; state?: string }
      | null;
    const description = body?.description?.trim();
    const classId = body?.class_id;
    if (!description || !classId) return NextResponse.json({ error: 'Missing description or class_id' }, { status: 400 });

    const guard = await guardClassAccess(classId);
    if (guard) return guard;

    // Resolve the standards state from the CLASS being written to (NOT the acting user) — a
    // platform_admin/cross-school author may write to a class in a different school than their own.
    // body.state override → class.school_id → schools.state → null (degrades gracefully).
    let state: string | null = isUsStateCode(body?.state) ? (body!.state as string).toUpperCase() : null;
    if (!state) {
      const { data: klass } = await admin.from('classes').select('school_id').eq('id', classId).maybeSingle();
      const classSchoolId = (klass as { school_id?: string | null } | null)?.school_id ?? null;
      if (classSchoolId) {
        const { data: school } = await admin.from('schools').select('state').eq('id', classSchoolId).maybeSingle();
        const s = (school as { state?: string | null } | null)?.state ?? null;
        state = isUsStateCode(s) ? s!.toUpperCase() : null;
      }
    }
    const framework = frameworkShortLabelForState(state);
    const guidance = standardsGuidance(state);

    const subject = body?.subject ?? null;
    const gradeLevel = body?.grade_level ?? null;
    const numDays = resolveNumDays(body?.num_days);

    // Generate the lesson(s).
    let chapterTitle: string | null = null;
    let generated: Array<{ dayIndex: number | null; lesson: Awaited<ReturnType<typeof generateLesson>> }>;
    if (numDays === 1) {
      const lesson = await generateLesson({ description, subject, grade_level: gradeLevel, standardsGuidance: guidance });
      generated = [{ dayIndex: null, lesson }];
    } else {
      const seg = await segmentUnit({ description, numDays, subject, grade_level: gradeLevel });
      chapterTitle = seg.unit_title;
      // Drive EACH day's generation by its own segment (title + focus) — NOT the whole-unit
      // description — so days don't overlap. Normalize day_index to the array position (i+1),
      // never the model-supplied d.day, so persisted day_index is always a clean 1..N sequence.
      const lessons = await Promise.all(seg.days.map((d, i) =>
        generateLesson({
          description: `${seg.unit_title} — Day ${i + 1}: ${d.title}. ${d.focus}`,
          focus: d.focus,
          subject,
          grade_level: gradeLevel,
          standardsGuidance: guidance,
        }),
      ));
      generated = seg.days.map((d, i) => ({ dayIndex: i + 1, lesson: lessons[i] }));
    }

    // Persist all rows in one insert; return the inserted ids + content for the review surface.
    const rows = generated.map(({ dayIndex, lesson }) => ({
      class_id: classId,
      teacher_id: user.id,
      title: lesson.title || (chapterTitle ? `${chapterTitle} — Day ${dayIndex}` : 'Untitled lesson'),
      parsed_content: lesson,
      subject: lesson.subject ?? subject,
      grade_level: lesson.grade_level ?? gradeLevel,
      status: 'pending_review',
      source: 'generate',
      chapter_title: chapterTitle,
      day_index: dayIndex,
      standard_framework: framework,
    }));

    const { data: inserted, error: insErr } = await admin
      .from('lessons')
      .insert(rows)
      .select('id, day_index, title, subject, grade_level, parsed_content, standard_framework');
    if (insErr || !inserted) {
      console.error('[teacher/lessons/generate] persist error:', insErr ?? 'no rows returned');
      return respondEngineError(new Error('Failed to persist generated lessons'));
    }

    const days = (inserted as Array<Record<string, unknown>>)
      .map((r) => ({
        lesson_id: r.id as string,
        day_index: (r.day_index as number | null) ?? null,
        title: r.title as string,
        subject: (r.subject as string | null) ?? null,
        grade_level: (r.grade_level as string | null) ?? null,
        parsed_content: r.parsed_content,
        standard_framework: (r.standard_framework as string) ?? framework,
      }))
      .sort((a, b) => (a.day_index ?? 0) - (b.day_index ?? 0));

    return NextResponse.json({ chapter_title: chapterTitle, framework, days });
  } catch (err) {
    console.error('[teacher/lessons/generate] error:', err);
    return respondEngineError(err);
  }
}
