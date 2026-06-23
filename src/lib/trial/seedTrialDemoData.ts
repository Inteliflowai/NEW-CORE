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

export interface SeedReport {
  seeded: string[];                              // step names that completed successfully
  skipped: { step: string; reason: string }[];  // steps that soft-failed or were gated out
}

export async function seedTrialDemoData(input: SeedTrialDemoDataInput): Promise<SeedReport> {
  const { admin, schoolId, schoolIdShort, teacherId, firstStudentId, parentId, password } = input;
  const now = new Date();

  const report: SeedReport = { seeded: [], skipped: [] };
  function recordOk(step: string) { report.seeded.push(step); }
  function recordSkip(step: string, reason: string) {
    report.skipped.push({ step, reason });
    console.error(`[trial-seed] ${step} failed (soft): ${reason}`);
  }

  const rows = buildTrialRows(DEMO_STUDENTS, { schoolId, schoolIdShort, teacherId }, now);

  // student_key → uuid. The first student (Alex) is pre-created in provisionTrial.
  const studentIds: Record<string, string> = {};
  const firstKey = DEMO_STUDENTS[0]?.key;
  if (firstKey && firstStudentId) studentIds[firstKey] = firstStudentId;

  // ── Step 1: Create auth users for students 2-8 (soft fail per student) ───────
  let studentsFailCount = 0;
  let studentsFirstError = '';
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
      studentsFailCount++;
      if (!studentsFirstError) studentsFirstError = (e as Error).message;
    }
  }
  if (studentsFailCount === 0) {
    recordOk('students');
  } else {
    recordSkip('students', `${studentsFailCount}/${rows.students.length} failed: ${studentsFirstError}`);
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
    recordOk('class');
  } catch (e) {
    classId = null;
    recordSkip('class', (e as Error).message);
  }

  // ── Step 3: Enrollments for all 8 students (soft fail) ───────────────────────
  if (classId) {
    let enrollFailCount = 0;
    let enrollFirstError = '';
    for (const enr of rows.enrollments) {
      const sid = studentIds[enr.student_key];
      if (!sid) continue;
      try {
        const { error } = await admin.from('enrollments').upsert(
          { class_id: classId, student_id: sid, is_active: true },
          { onConflict: 'class_id,student_id' }
        );
        if (error) throw error;
      } catch (e) {
        enrollFailCount++;
        if (!enrollFirstError) enrollFirstError = (e as Error).message;
      }
    }
    if (enrollFailCount === 0) {
      recordOk('enrollments');
    } else {
      recordSkip('enrollments', `${enrollFailCount}/${rows.enrollments.length} failed: ${enrollFirstError}`);
    }
  } else {
    recordSkip('enrollments', 'prerequisite class missing');
  }

  // ── Step 4: Link parent → first student (Alex): users.parent_id + guardians ──
  const alexId = firstKey ? studentIds[firstKey] : undefined;
  if (parentId && alexId) {
    try {
      const { error: upErr } = await admin.from('users').update({ parent_id: parentId }).eq('id', alexId);
      if (upErr) throw upErr;
      const { error: gErr } = await admin.from('guardians').upsert(
        { parent_id: parentId, student_id: alexId },
        { onConflict: 'parent_id,student_id' }
      );
      if (gErr) throw gErr;
      recordOk('guardian_link');
    } catch (e) {
      recordSkip('guardian_link', (e as Error).message);
    }
  } else {
    recordSkip('guardian_link', 'prerequisite parentId or alexId missing');
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
      recordOk('lesson');
    } catch (e) {
      lessonId = null;
      recordSkip('lesson', (e as Error).message);
    }
  } else {
    recordSkip('lesson', 'prerequisite class missing');
  }

  // ── Step 6: Quiz + 5 quiz_questions (soft fail) ──────────────────────────────
  let quizId: string | null = null;
  if (classId && lessonId) {
    let qqFailCount = 0;
    let qqFirstError = '';
    let quizFailReason: string | null = null;
    try {
      quizId = randomUUID();
      const { error } = await admin.from('quizzes').insert({
        id: quizId, lesson_id: lessonId, class_id: classId, teacher_id: teacherId,
        title: rows.quiz.title, status: rows.quiz.status, published_at: now.toISOString(),
      });
      if (error) throw error;
      for (const q of rows.quiz_questions) {
        const { error: qErr } = await admin.from('quiz_questions').insert({
          quiz_id: quizId, position: q.position, question_type: q.question_type, question_text: q.question_text,
        });
        if (qErr) { qqFailCount++; if (!qqFirstError) qqFirstError = qErr.message; }
      }
    } catch (e) {
      quizId = null;
      quizFailReason = (e as Error).message;
    }
    if (quizFailReason) {
      recordSkip('quiz', quizFailReason);
    } else if (qqFailCount > 0) {
      recordSkip('quiz', `${qqFailCount}/${rows.quiz_questions.length} quiz_questions failed: ${qqFirstError}`);
    } else {
      recordOk('quiz');
    }
  } else {
    recordSkip('quiz', `prerequisite ${!classId ? 'class' : 'lesson'} missing`);
  }

  // ── Step 7: Quiz attempts (soft fail) ────────────────────────────────────────
  if (quizId) {
    let qaFailCount = 0;
    let qaFirstError = '';
    for (const qa of rows.quiz_attempts) {
      const sid = studentIds[qa.student_key];
      if (!sid) continue;
      try {
        const { error } = await admin.from('quiz_attempts').insert({
          quiz_id: quizId,
          student_id: sid,
          score_pct: qa.score_pct,
          mastery_band: qa.mastery_band,
          submitted_at: qa.submitted_at,
          is_complete: true,
          grading_status: 'complete',
        });
        if (error) throw error;
      } catch (e) {
        qaFailCount++;
        if (!qaFirstError) qaFirstError = (e as Error).message;
      }
    }
    if (qaFailCount === 0) {
      recordOk('quiz_attempts');
    } else {
      recordSkip('quiz_attempts', `${qaFailCount}/${rows.quiz_attempts.length} failed: ${qaFirstError}`);
    }
  } else {
    recordSkip('quiz_attempts', 'prerequisite quiz missing');
  }

  // ── Step 8: Assignments + homework_attempts (band-differentiated) ────────────
  const assignmentIds: Record<string, string> = {}; // `${assignmentKey}:${studentKey}` → uuid
  if (classId) {
    let assignFailCount = 0;
    let assignFirstError = '';
    const totalAssignments = rows.assignments.length * DEMO_STUDENTS.length;
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
            assigned_at: assignment.assigned_at,
            reteach_needed: student.reteachNeeded ?? false,
          });
          if (aErr) throw aErr;
          assignmentIds[assignmentKey] = aId;
        } catch (e) {
          assignFailCount++;
          if (!assignFirstError) assignFirstError = (e as Error).message;
        }
      }
    }
    if (assignFailCount === 0) {
      recordOk('assignments');
    } else {
      recordSkip('assignments', `${assignFailCount}/${totalAssignments} failed: ${assignFirstError}`);
    }

    let hwFailCount = 0;
    let hwFirstError = '';
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
          hwFailCount++;
          if (!hwFirstError) hwFirstError = hErr.message;
        }
      } catch (e) {
        hwFailCount++;
        if (!hwFirstError) hwFirstError = (e as Error).message;
      }
    }
    if (hwFailCount === 0) {
      recordOk('homework_attempts');
    } else {
      recordSkip('homework_attempts', `${hwFailCount}/${rows.homework_attempts.length} failed: ${hwFirstError}`);
    }
  } else {
    recordSkip('assignments', 'prerequisite class missing');
    recordSkip('homework_attempts', 'prerequisite class missing');
  }

  // ── Step 9a: Skill — insert-if-absent (no ON CONFLICT against expression index) ─
  let skillId: string | null = null;
  try {
    // Pre-query to find existing skill by (school_id, slug, null subject)
    const { data: existingSkill } = await admin
      .from('skills')
      .select('id')
      .eq('school_id', schoolId)
      .eq('slug', 'demo-skill-1')
      .is('subject', null)
      .maybeSingle();

    if (existingSkill) {
      skillId = existingSkill.id;
    } else {
      skillId = randomUUID();
      const { error: skillErr } = await admin.from('skills').insert({
        id: skillId,
        school_id: schoolId,
        slug: 'demo-skill-1',
        name: 'Core Concept Analysis',
        subject: null,
        status: 'active',
        created_by: 'ai',
        aliases: [],
      });
      if (skillErr) throw skillErr;
    }
    recordOk('skill');
  } catch (e) {
    skillId = null;
    recordSkip('skill', (e as Error).message);
  }

  // ── Step 9b: Skill learning state (upsert onConflict student_id,skill_id) ─────
  if (skillId) {
    let slsFailCount = 0;
    let slsFirstError = '';
    for (const sls of rows.skill_learning_state) {
      const sid = studentIds[sls.student_key];
      if (!sid) continue;
      try {
        const row: Record<string, unknown> = {
          student_id: sid,
          school_id: schoolId,
          skill_id: skillId,
          state: sls.state,
          confidence: sls.confidence,
          observation_count: sls.observation_count,
          evidence: sls.evidence,
        };
        if (sls.last_reteach_outcome) row.last_reteach_outcome = sls.last_reteach_outcome;

        const { error } = await admin.from('skill_learning_state').upsert(row, {
          onConflict: 'student_id,skill_id',
        });
        if (error) throw error;
      } catch (e) {
        slsFailCount++;
        if (!slsFirstError) slsFirstError = (e as Error).message;
      }
    }
    if (slsFailCount === 0) {
      recordOk('skill_learning_state');
    } else {
      recordSkip('skill_learning_state', `${slsFailCount}/${rows.skill_learning_state.length} failed: ${slsFirstError}`);
    }
  } else {
    recordSkip('skill_learning_state', 'prerequisite skill missing');
  }

  // ── Step 9c: Misconception observations (insert) ─────────────────────────────
  if (skillId) {
    let miscFailCount = 0;
    let miscFirstError = '';
    for (const m of rows.misconceptions) {
      const sid = studentIds[m.student_key];
      if (!sid) continue;
      try {
        const { error } = await admin.from('misconception_observations').insert({
          student_id: sid,
          skill_id: skillId,
          school_id: schoolId,
          error_type: m.error_type,
          reasoning_pattern: m.reasoning_pattern,
          observed_at: m.observed_at,
        });
        if (error) throw error;
      } catch (e) {
        miscFailCount++;
        if (!miscFirstError) miscFirstError = (e as Error).message;
      }
    }
    if (miscFailCount === 0) {
      recordOk('misconceptions');
    } else {
      recordSkip('misconceptions', `${miscFailCount}/${rows.misconceptions.length} failed: ${miscFirstError}`);
    }
  } else {
    recordSkip('misconceptions', 'prerequisite skill missing');
  }

  // ── Step 10: Student model snapshots (≥4/student; soft fail) ─────────────────
  let snapFailCount = 0;
  let snapFirstError = '';
  for (const snap of rows.snapshots) {
    const sid = studentIds[snap.student_key];
    if (!sid) continue;
    try {
      const { error } = await admin.from('student_model_snapshots').upsert(
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
      if (error) throw error;
    } catch (e) {
      snapFailCount++;
      if (!snapFirstError) snapFirstError = (e as Error).message;
    }
  }
  if (snapFailCount === 0) {
    recordOk('snapshots');
  } else {
    recordSkip('snapshots', `${snapFailCount}/${rows.snapshots.length} failed: ${snapFirstError}`);
  }

  return report;
}
