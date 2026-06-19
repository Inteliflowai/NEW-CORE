/**
 * src/lib/trial/seedTrialDemoData.ts
 *
 * Trial-tenant demo seeder. Keeps V1's input interface (lib/trial/seedTrialDemoData.ts).
 * The PURE row construction lives in buildTrialRows.ts; this module is the Supabase
 * WRITER that resolves keys → UUIDs and performs the inserts.
 *
 * Reuses the same engineered profiles (demoCast.DEMO_STUDENTS) so a trial tenant
 * lights up identically to the demo seed.
 *
 * SOFT-FAIL contract (p4b-05 §15): each step is wrapped in try/catch; a partial
 * seed is better than no provisioning. This function never throws — provisioning
 * still returns a result even if some seed steps fail.
 *
 * OMITTED (C8 — tables do not exist in V2): student_model, student_gamification,
 * signal_aggregates, alerts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { DEMO_STUDENTS } from '@/lib/demo/demoCast';
import { ensureAuthUser } from '@/lib/trial/ensureAuthUser';
import { buildTrialRows } from '@/lib/trial/buildTrialRows';

export interface SeedTrialDemoDataInput {
  admin: SupabaseClient;
  schoolId: string;
  schoolIdShort: string;   // schoolId.slice(0, 8) — used in student email generation
  teacherId: string;
  firstStudentId: string | null;   // Alex Rivera — already created in provisionTrial
  parentId: string | null;
  password: string;
}

export async function seedTrialDemoData(input: SeedTrialDemoDataInput): Promise<void> {
  const { admin, schoolId, schoolIdShort, teacherId, firstStudentId, parentId, password } = input;
  const now = new Date();

  const rows = buildTrialRows(DEMO_STUDENTS, { schoolId, schoolIdShort, teacherId }, now);

  // student_key → uuid. The first student (Alex) is pre-created in provisionTrial.
  const studentIds: Record<string, string> = {};
  const firstKey = DEMO_STUDENTS[0]?.key;
  if (firstKey && firstStudentId) studentIds[firstKey] = firstStudentId;

  // ── Step 1: Create auth users for students 2-8 (soft fail per student) ───────
  for (const spec of rows.students) {
    try {
      const sid = await ensureAuthUser({
        admin,
        email: spec.email,
        password,
        full_name: spec.full_name,
        role: 'student',
        school_id: schoolId,
      });
      studentIds[spec.key] = sid;
    } catch (e) {
      console.error(`[trial-seed] student ${spec.key} failed (soft):`, (e as Error).message);
    }
  }

  // ── Step 2: Class (soft fail) ────────────────────────────────────────────────
  let classId: string | null = null;
  try {
    classId = randomUUID();
    const { error } = await admin.from('classes').insert({
      id: classId,
      school_id: rows.class.school_id,
      teacher_id: rows.class.teacher_id,
      name: rows.class.name,
      subject: rows.class.subject,
      grade_level: rows.class.grade_level,
      is_active: true,
    });
    if (error) throw error;
  } catch (e) {
    classId = null;
    console.error('[trial-seed] class creation failed (soft):', (e as Error).message);
  }

  // ── Step 3: Enrollments for all 8 students (soft fail) ───────────────────────
  if (classId) {
    for (const enr of rows.enrollments) {
      const sid = studentIds[enr.student_key];
      if (!sid) continue;
      try {
        await admin.from('enrollments').upsert(
          { class_id: classId, student_id: sid, is_active: true },
          { onConflict: 'class_id,student_id' }
        );
      } catch (e) {
        console.error(`[trial-seed] enrollment ${enr.student_key} failed (soft):`, (e as Error).message);
      }
    }
  }

  // ── Step 4: Link parent → first student (Alex): users.parent_id + guardians ──
  const alexId = firstKey ? studentIds[firstKey] : undefined;
  if (parentId && alexId) {
    try {
      await admin.from('users').update({ parent_id: parentId }).eq('id', alexId);
      await admin.from('guardians').upsert(
        { parent_id: parentId, student_id: alexId },
        { onConflict: 'parent_id,student_id' }
      );
    } catch (e) {
      console.error('[trial-seed] guardian link failed (soft):', (e as Error).message);
    }
  }

  // ── Step 5: Lesson (soft fail) ───────────────────────────────────────────────
  let lessonId: string | null = null;
  if (classId) {
    try {
      lessonId = randomUUID();
      const { error } = await admin.from('lessons').insert({
        id: lessonId,
        class_id: classId,
        teacher_id: teacherId,
        title: rows.lesson.title,
        status: rows.lesson.status,
        parsed_content: rows.lesson.parsed_content,
      });
      if (error) throw error;
    } catch (e) {
      lessonId = null;
      console.error('[trial-seed] lesson creation failed (soft):', (e as Error).message);
    }
  }

  // ── Step 6: Quiz + 5 quiz_questions (soft fail) ──────────────────────────────
  let quizId: string | null = null;
  if (classId && lessonId) {
    try {
      quizId = randomUUID();
      const { error } = await admin.from('quizzes').insert({
        id: quizId,
        lesson_id: lessonId,
        class_id: classId,
        teacher_id: teacherId,
        title: rows.quiz.title,
        status: rows.quiz.status,
        published_at: now.toISOString(),
      });
      if (error) throw error;

      for (const q of rows.quiz_questions) {
        const { error: qErr } = await admin.from('quiz_questions').insert({
          quiz_id: quizId,
          position: q.position,
          question_type: q.question_type,
          question_text: q.question_text,
        });
        if (qErr) {
          console.error(`[trial-seed] quiz_question ${q.position} failed (soft):`, qErr.message);
        }
      }
    } catch (e) {
      quizId = null;
      console.error('[trial-seed] quiz creation failed (soft):', (e as Error).message);
    }
  }

  // ── Step 7: Quiz attempts (soft fail) ────────────────────────────────────────
  if (quizId) {
    for (const qa of rows.quiz_attempts) {
      const sid = studentIds[qa.student_key];
      if (!sid) continue;
      try {
        await admin.from('quiz_attempts').insert({
          quiz_id: quizId,
          student_id: sid,
          score_pct: qa.score_pct,
          mastery_band: qa.mastery_band,
          submitted_at: qa.submitted_at,
          is_complete: true,
          grading_status: 'complete',
        });
      } catch (e) {
        console.error(`[trial-seed] quiz_attempt ${qa.student_key} failed (soft):`, (e as Error).message);
      }
    }
  }

  // ── Step 8: Assignments + homework_attempts (band-differentiated) ────────────
  const assignmentIds: Record<string, string> = {}; // `${assignmentKey}:${studentKey}` → uuid
  if (classId) {
    for (const assignment of rows.assignments) {
      for (const student of DEMO_STUDENTS) {
        const sid = studentIds[student.key];
        if (!sid) continue;

        const band: 'reteach' | 'grade_level' | 'advanced' =
          student.expect.band === 'advanced' ? 'advanced'
          : student.expect.band === 'reteach' ? 'reteach'
          : 'grade_level';

        const assignmentKey = `${assignment.key}:${student.key}`;
        try {
          const aId = randomUUID();
          const { error: aErr } = await admin.from('assignments').insert({
            id: aId,
            student_id: sid,
            class_id: classId,
            lesson_id: lessonId ?? undefined,
            mastery_band: band,
            content: assignment.content, // jsonb NOT NULL (C9)
            status: assignment.status,
            due_at: assignment.due_at,
            reteach_needed: student.reteachNeeded ?? false,
          });
          if (aErr) throw aErr;
          assignmentIds[assignmentKey] = aId;
        } catch (e) {
          console.error(`[trial-seed] assignment ${assignmentKey} failed (soft):`, (e as Error).message);
        }
      }
    }

    for (const attempt of rows.homework_attempts) {
      const sid = studentIds[attempt.student_key];
      if (!sid) continue;
      const aId = assignmentIds[`${attempt.assignment_key}:${attempt.student_key}`];
      if (!aId) continue;
      try {
        const hw: Record<string, unknown> = {
          assignment_id: aId,
          student_id: sid,
          status: attempt.status,
          score_pct: attempt.score_pct,
          submitted_at: attempt.submitted_at,
          responses: attempt.responses, // { response_text } — NEVER class_id (C10)
          effort_label: attempt.effort_label ?? null,
          allow_redo: attempt.allow_redo ?? false,
          is_redo: attempt.is_redo ?? false,
          flagged_by: attempt.flagged_by ?? null,
        };
        if (attempt.graded_at) hw.graded_at = attempt.graded_at;

        const { error: hErr } = await admin.from('homework_attempts').insert(hw);
        if (hErr) {
          console.error(`[trial-seed] homework_attempt ${attempt.student_key}/${attempt.assignment_key} failed (soft):`, hErr.message);
        }
      } catch (e) {
        console.error(`[trial-seed] homework_attempt ${attempt.student_key}/${attempt.assignment_key} failed (soft):`, (e as Error).message);
      }
    }
  }

  // ── Step 9: Student model snapshots (≥4/student; soft fail) ──────────────────
  for (const snap of rows.snapshots) {
    const sid = studentIds[snap.student_key];
    if (!sid) continue;
    try {
      await admin.from('student_model_snapshots').upsert(
        {
          student_id: sid,
          school_id: schoolId,
          class_id: classId ?? undefined,
          snapshot_date: snap.snapshot_date,
          mastery_band: snap.mastery_band ?? undefined,
          avg_score: snap.avg_score,
          risk_score: snap.risk_score,
          divergence_score: snap.divergence_score ?? undefined,
          consistency_label: snap.consistency_label,
          dominant_effort_pattern: snap.dominant_effort_pattern,
          improvement_4w: snap.improvement_4w,
          consistency_score: snap.consistency_score,
          snapshot_schema_version: snap.snapshot_schema_version,
        },
        { onConflict: 'student_id,snapshot_date' }
      );
    } catch (e) {
      console.error(`[trial-seed] snapshot ${snap.student_key}/${snap.snapshot_date} failed (soft):`, (e as Error).message);
    }
  }
}
