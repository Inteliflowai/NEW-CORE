// src/app/api/teacher/assignments/generate/route.ts
// POST /api/teacher/assignments/generate
// Engine call #5 (+ #5a) â€” generate a differentiated assignment for a student.
//
// Auth: auth.getUser() â†’ 401. guardStudentAccess(attempt.student_id) â†’ guard response.
// C15: class_id + lesson_id are read from the quizzes join (NOT from quiz_attempts).
// C20: if mastery_band is null â†’ 409 refusal; generateAssignment is NOT called.
// C17: if no valid learning_style â†’ build behavioral signals, call inferLearningStyle (#5a).
// C6:  normalizeLearningStyle applied ONLY at the persist boundary.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardStudentAccess } from '@/lib/auth/guards';
import { generateAssignment, inferLearningStyle } from '@/lib/engine/assignmentGen';
import { normalizeLearningStyle } from '@/lib/utils/learningStyle';
import { OPENAI_GEN_MODEL } from '@/lib/ai/models';
import { respondEngineError } from '@/app/api/_lib/errorEnvelope';
import { computeBehavioralSummary, formatSignalsForPrompt } from '@/lib/utils/scoring';
import { getSparkLink } from '@/lib/spark/sparkLink';
import { notifyAssignmentCreated } from '@/lib/spark/notifyAssignmentCreated';

// Shape of the widened quiz_attempts row (with quizzes/lessons + users joins).
// Supabase's typed-query inference can't resolve a join this deep and returns
// GenericStringError, so the query result is cast to this interface. Field types
// match the inline casts the route already relied on.
interface AttemptJoinRow {
  id: string;
  student_id: string;
  mastery_band: 'reteach' | 'grade_level' | 'advanced' | null;
  learning_style: string | null;
  quizzes: {
    class_id: string | null;
    lesson_id: string | null;
    lessons: {
      parsed_content: { key_concepts?: string[] } | null;
      title: string | null;
      grade_level: string | null;
      subject: string | null;
    } | null;
  } | null;
  users: {
    full_name: string | null;
    grade_level: string | null;
    school_id: string | null;
  } | null;
}

export async function POST(req: NextRequest) {
  try {
    // â”€â”€ Auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // â”€â”€ Input â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const body = await req.json();
    const { quiz_attempt_id, learning_style: requestedStyle } = body as {
      quiz_attempt_id?: string;
      learning_style?: string;
    };
    if (!quiz_attempt_id) {
      return NextResponse.json({ error: 'Missing quiz_attempt_id' }, { status: 400 });
    }

    // â”€â”€ Fetch attempt with quizzes join (C15: class_id + lesson_id from quizzes) â”€â”€
    // The widened nested select below exceeds Supabase's typed-query inference
    // (data resolves to GenericStringError), so we cast the row to the local
    // AttemptJoinRow shape. The runtime data shape is correct; this is purely a
    // TypeScript inference limitation -- do NOT narrow the select to satisfy tsc.
    const admin = createAdminSupabaseClient();
    const { data } = await admin
      .from('quiz_attempts')
      .select(
        'id, student_id, mastery_band, learning_style, ' +
        'quizzes(class_id, lesson_id, lessons(parsed_content, title, grade_level, subject)), ' +
        'users:student_id(full_name, grade_level, school_id)',
      )
      .eq('id', quiz_attempt_id)
      .single();
    const attempt = (data ?? null) as unknown as AttemptJoinRow | null;

    if (!attempt) {
      return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
    }

    // â”€â”€ Object-level guard: IDOR â€” RLS is NOT the backstop on the admin client â”€â”€
    const guard = await guardStudentAccess(attempt.student_id as string);
    if (guard) return guard;

    // â”€â”€ C20: refuse when mastery_band is null (do NOT silently default) â”€â”€â”€â”€â”€â”€
    const band = attempt.mastery_band as 'reteach' | 'grade_level' | 'advanced' | null;
    if (!band) {
      return NextResponse.json(
        {
          error:
            'Attempt not graded yet â€” submit and grade the quiz before generating an assignment.',
        },
        { status: 409 },
      );
    }

    // â”€â”€ Resolve lesson content from the quizzes join (C15) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const quizzesJoin = attempt.quizzes as unknown as {
      class_id: string;
      lesson_id: string;
      lessons: { parsed_content: unknown; title: string };
    } | null;
    const classId = quizzesJoin?.class_id ?? null;
    const lessonId = quizzesJoin?.lesson_id ?? null;
    const lesson = quizzesJoin?.lessons ?? null;
    const studentName =
      (attempt.users as { full_name?: string } | null)?.full_name ?? 'Student';
    const lessonSummary = JSON.stringify(lesson?.parsed_content ?? {}, null, 2);

    // â”€â”€ C17: resolve learning style â€” infer if absent â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // The brief's `style = learning_style || 'emerging'` silently skips #5a.
    // Correct path: if no style is present, build behavioral signals and invoke
    // inferLearningStyle so the 6-value style is actually determined, not assumed.
    const attemptStyle = (attempt.learning_style as string | null) || requestedStyle || null;
    let style: string;
    if (attemptStyle) {
      style = attemptStyle;
    } else {
      // No style on attempt or request â€” fetch behavioral telemetry and infer
      const { data: responses, error: responsesError } = await admin
        .from('quiz_responses')
        .select('response_time_ms, hesitation_ms, answer_changes, word_count, response_text')
        .eq('attempt_id', quiz_attempt_id);
      if (responsesError) {
        console.error('[teacher/assignments/generate] quiz_responses fetch error:', responsesError);
      }

      const safeResponses = (responses ?? []) as Array<{
        response_time_ms?: number;
        hesitation_ms?: number;
        answer_changes: number;
        word_count?: number;
        response_text?: string;
      }>;

      const behavioral = computeBehavioralSummary(safeResponses);
      const wordCounts = safeResponses.map((r) => r.word_count ?? 0);
      const signals = formatSignalsForPrompt(behavioral, wordCounts);

      // #5a â€” infer; degrades to 'emerging' on failure (C1 within inferLearningStyle)
      const inferred = await inferLearningStyle(signals);
      style = inferred.learning_style;
    }

    // â”€â”€ Engine call #5: generate assignment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const assignment = await generateAssignment({
      lessonSummary,
      band,
      style,         // 6-value prompt vocabulary (read_write/tactile pass through)
      studentName,
    });

    // â”€â”€ Persist (C6: normalizeLearningStyle ONLY at the write boundary) â”€â”€â”€â”€â”€â”€
    const { data: row, error: insErr } = await admin
      .from('assignments')
      .insert({
        quiz_attempt_id: attempt.id,
        student_id: attempt.student_id,
        class_id: classId,          // C15: from quizzes join
        lesson_id: lessonId,        // C15: from quizzes join
        mastery_band: band,
        learning_style: normalizeLearningStyle(style), // C6: normalize at boundary
        content: assignment,
        status: 'draft',
        assigned_at: new Date().toISOString(), // gradebook v1.1: the day this was assigned (never changes)
        generation_model: OPENAI_GEN_MODEL,
      })
      .select()
      .single();

    if (insErr || !row) {
      return NextResponse.json({ error: 'Failed to save assignment' }, { status: 500 });
    }

    // ── SPARK create-notify (non-blocking; never fails assignment generation) ──
    try {
      const userRow = attempt.users as { school_id?: string; grade_level?: string | null } | null;
      const schoolId = userRow?.school_id ?? null;
      if (schoolId) {
        const link = await getSparkLink(admin, schoolId);
        if (link) {
          const lessonRow =
            ((attempt.quizzes as { lessons?: Record<string, unknown> } | null)?.lessons ?? {}) as {
              parsed_content?: { key_concepts?: string[] };
              grade_level?: string | null;
              subject?: string | null;
            };
          const grade = userRow?.grade_level ?? lessonRow.grade_level ?? null;
          const result = await notifyAssignmentCreated({
            coreHomeworkId: row.id as string,
            studentId: attempt.student_id as string,
            schoolId,
            coreClassId: classId,
            band,
            learningStyle: normalizeLearningStyle(style),
            grade,
            subject: lessonRow.subject ?? null,
            conceptTags: lessonRow.parsed_content?.key_concepts ?? [],
            title: assignment.title,
            content: `${assignment.title}\n\n${assignment.instructions}`,
          });
          await admin
            .from('assignments')
            .update({
              spark_assignment_id: result.sparkAssignmentId,
              spark_attempt_id: result.sparkAttemptId ?? null,
              spark_experiment_id: result.syntheticExperimentId ?? null,
              spark_status: result.success ? 'created' : 'notify_failed',
            })
            .eq('id', row.id);
        }
      }
    } catch (sparkErr) {
      console.error('[teacher/assignments/generate] spark notify failed (non-blocking):', sparkErr);
      try {
        await admin.from('assignments').update({ spark_status: 'notify_failed' }).eq('id', row.id);
      } catch {
        /* best-effort; never block assignment generation */
      }
    }

    return NextResponse.json({ assignment_id: row.id, content: assignment });
  } catch (err) {
    console.error('[teacher/assignments/generate] error:', err);
    return respondEngineError(err);
  }
}

