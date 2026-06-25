// src/app/api/teacher/assignments/reinforce/route.ts
// POST /api/teacher/assignments/reinforce
// Generates a NEW EASIER (mastery_band='reteach') assignment for a student in the background,
// tied to their existing homework_attempt. Returns 202 immediately; the generation runs inside
// Next's after() so the teacher's UI is never blocked on the LLM call.
//
// Auth chain: createServerSupabaseClient → getUser → STAFF_ROLES gate →
//   homework_attempts → assignments lookup → guardClassAccess(class_id) → 202 +
//   after(() => { generateAssignment + insert })
//
// The generated assignment uses status='draft' (matching the generate route) because
// loadStudentAssignments has NO status filter — all assignments are visible to students
// regardless of status. 'draft' is the conventional initial status used throughout the codebase.
import { NextRequest, NextResponse, after } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardClassAccess } from '@/lib/auth/guards';
import { generateAssignment } from '@/lib/engine/assignmentGen';
import { normalizeLearningStyle } from '@/lib/utils/learningStyle';
import { LlmExhaustedError } from '@/lib/ai/errors';
import { OPENAI_GEN_MODEL } from '@/lib/ai/models';
import { getSparkLink } from '@/lib/spark/sparkLink';
import { notifyAssignmentCreated } from '@/lib/spark/notifyAssignmentCreated';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Input ───────────────────────────────────────────────────────────────────
  let body: { attempt_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  if (!body?.attempt_id) {
    return NextResponse.json({ error: 'Missing attempt_id' }, { status: 400 });
  }
  const { attempt_id } = body;

  // ── Role gate ────────────────────────────────────────────────────────────────
  const admin = createAdminSupabaseClient();
  const { data: roleRow } = await admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  const role = (roleRow as { role?: string } | null)?.role;
  if (!role || !new Set<string>(STAFF_ROLES).has(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── Load attempt ─────────────────────────────────────────────────────────────
  const { data: attemptRow } = await admin
    .from('homework_attempts')
    .select('id, assignment_id, student_id')
    .eq('id', attempt_id)
    .maybeSingle();
  const attempt = attemptRow as {
    id: string;
    assignment_id: string;
    student_id: string;
  } | null;
  if (!attempt) {
    return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
  }

  // ── Load assignment (with lesson join) ───────────────────────────────────────
  const { data: asgRow } = await admin
    .from('assignments')
    .select(
      'id, class_id, lesson_id, learning_style, ' +
      'lessons(parsed_content, title, subject, grade_level)',
    )
    .eq('id', attempt.assignment_id)
    .maybeSingle();

  interface AssignmentJoin {
    id: string;
    class_id: string;
    lesson_id: string | null;
    learning_style: string | null;
    lessons: {
      parsed_content: unknown;
      title: string | null;
      subject: string | null;
      grade_level: string | null;
    } | null;
  }

  const asg = (asgRow ?? null) as unknown as AssignmentJoin | null;
  if (!asg) {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  }

  // ── Object-level IDOR guard ──────────────────────────────────────────────────
  const guard = await guardClassAccess(asg.class_id);
  if (guard) return guard;

  // ── Load student (name + school + grade for SPARK notify) ───────────────────
  const { data: studentRow } = await admin
    .from('users')
    .select('full_name, school_id, grade_level')
    .eq('id', attempt.student_id)
    .maybeSingle();
  const studentData = studentRow as {
    full_name?: string | null;
    school_id?: string | null;
    grade_level?: string | null;
  } | null;
  const studentName = studentData?.full_name ?? 'Student';
  const schoolId = studentData?.school_id ?? null;
  const studentGradeLevel = studentData?.grade_level ?? null;

  // ── Snapshot data needed inside after() before returning ────────────────────
  const lessonRow = asg.lessons as {
    parsed_content?: { key_concepts?: string[] };
    subject?: string | null;
    grade_level?: string | null;
  } | null;
  const lessonSummary = JSON.stringify(lessonRow?.parsed_content ?? {}, null, 2);
  const learningStyle = asg.learning_style ?? 'emerging';
  const classId = asg.class_id;
  const lessonId = asg.lesson_id;
  const studentId = attempt.student_id;
  const lessonSubject = lessonRow?.subject ?? null;
  const lessonGradeLevel = lessonRow?.grade_level ?? null;
  const lessonKeyConcepts = lessonRow?.parsed_content?.key_concepts ?? [];

  // ── Return 202 immediately — generation runs in the background ───────────────
  after(async () => {
    try {
      const assignment = await generateAssignment({
        lessonSummary,
        band: 'reteach',
        style: learningStyle,
        studentName,
      });

      const { data: insRow, error: insErr } = await admin
        .from('assignments')
        .insert({
          quiz_attempt_id: null,          // reinforce is NOT tied to a quiz attempt
          student_id: studentId,
          class_id: classId,
          lesson_id: lessonId,
          mastery_band: 'reteach',
          learning_style: normalizeLearningStyle(learningStyle),
          content: assignment,
          status: 'draft',
          assigned_at: new Date().toISOString(),
          generation_model: OPENAI_GEN_MODEL,
        })
        .select('id')
        .single();

      if (insErr || !insRow) {
        console.error('[assignments/reinforce] insert failed — skipping SPARK notify:', insErr);
        return;
      }

      // ── SPARK create-notify (non-blocking; never fails assignment creation) ──
      try {
        if (schoolId) {
          const link = await getSparkLink(admin, schoolId);
          if (link) {
            const grade = studentGradeLevel ?? lessonGradeLevel ?? null;
            const result = await notifyAssignmentCreated({
              coreHomeworkId: (insRow as { id: string }).id,
              studentId,
              schoolId,
              coreClassId: classId,
              band: 'reteach',
              learningStyle: normalizeLearningStyle(learningStyle),
              grade,
              subject: lessonSubject,
              conceptTags: lessonKeyConcepts,
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
              .eq('id', (insRow as { id: string }).id);
          }
        }
      } catch (sparkErr) {
        console.error('[assignments/reinforce] spark notify failed (non-blocking):', sparkErr);
        try {
          await admin
            .from('assignments')
            .update({ spark_status: 'notify_failed' })
            .eq('id', (insRow as { id: string }).id);
        } catch {
          /* best-effort; never block assignment creation */
        }
      }
    } catch (err) {
      if (err instanceof LlmExhaustedError) {
        console.error('[assignments/reinforce] LLM exhausted — no row created; teacher can retry:', err.message);
      } else {
        console.error('[assignments/reinforce] unexpected error in after():', err);
      }
      // Never throw out of after() — the 202 has already been sent
    }
  });

  return NextResponse.json({ ok: true, status: 'creating' }, { status: 202 });
}
