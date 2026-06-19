/**
 * scripts/seedDemo.ts
 *
 * Demo seed writer for CORE v2 Plan 4b.
 *
 * Reads SUPABASE_SECRET_KEY + NEXT_PUBLIC_SUPABASE_URL from env.
 * Creates the demo school, teacher, parent, admin, 8 students, class,
 * enrollments, skills, lesson, quiz, and all signal rows.
 *
 * SECURITY:
 *  - Reconciles auth users by AUTH ID, never by email (C13).
 *  - Never logs secrets.
 *  - Never creates/modifies platform_admin (C14).
 *  - Hard-fail on school + teacher creation; soft-fail on everything else.
 *
 * Run: npm run seed:demo
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { buildSeedRows } from '../src/lib/demo/buildSeedRows';
import { ensureAuthUser } from '../src/lib/trial/ensureAuthUser';
import {
  DEMO_STUDENTS,
  DEMO_TEACHER,
  DEMO_PARENT,
  DEMO_ADMIN,
  DEMO_SCHOOL_NAME,
} from '../src/lib/demo/demoCast';

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in environment.');
  process.exit(1);
}

// Admin client is synchronous (createAdminSupabaseClient pattern from p4b-02-auth.md)
const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

// ── Helpers ───────────────────────────────────────────────────────────────────
// ensureAuthUser + findAuthIdByEmail moved to src/lib/trial/ensureAuthUser.ts so the
// seed and trial provisioning share the SAME account-takeover guard. Call sites below
// pass the admin client explicitly.

/** Find or insert a skill by (school_id, slug, subject) — no ON CONFLICT (expression index). */
async function ensureSkill({
  school_id,
  slug,
  name,
  subject,
}: {
  school_id: string;
  slug: string;
  name: string;
  subject: string | null;
}): Promise<string> {
  // pre-query insert-if-absent keyed on (school_id, slug) + subject (treat null as '')
  const subjectNorm = subject ?? '';
  const { data: existing } = await admin
    .from('skills')
    .select('id')
    .eq('school_id', school_id)
    .eq('slug', slug)
    .eq('subject', subjectNorm === '' ? null : subjectNorm)  // null subject stored as null
    .maybeSingle();

  // Handle case where subject is null — maybeSingle filter on null needs is()
  // Re-query using the correct approach for null subject
  if (subjectNorm === '') {
    const { data: existingNull } = await admin
      .from('skills')
      .select('id')
      .eq('school_id', school_id)
      .eq('slug', slug)
      .is('subject', null)
      .maybeSingle();
    if (existingNull) return existingNull.id;
  } else if (existing) {
    return existing.id;
  }

  const newId = randomUUID();
  const { error } = await admin.from('skills').insert({
    id: newId,
    school_id,
    slug,
    name,
    subject: subject ?? null,
    status: 'active',
    created_by: 'ai',
    aliases: [],
  });
  if (error) throw error;
  return newId;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const now = new Date();
  const DEMO_PASSWORD = 'DemoCore#2026';
  const CLASS_NAME = 'Demo Period 1';

  // ── Step 1: Ensure demo school (HARD FAIL) ────────────────────────────────
  console.log('[seed] Ensuring demo school…');
  let schoolId: string;

  const { data: existingSchool } = await admin
    .from('schools')
    .select('id')
    .eq('name', DEMO_SCHOOL_NAME)
    .eq('demo_mode', true)
    .maybeSingle();

  if (existingSchool) {
    schoolId = existingSchool.id;
    console.log(`[seed] Reusing existing school ${schoolId}`);
  } else {
    schoolId = randomUUID();
    const { error: schoolErr } = await admin.from('schools').insert({
      id: schoolId,
      name: DEMO_SCHOOL_NAME,
      demo_mode: true,
      is_active: true,
    });
    if (schoolErr) throw new Error(`Failed to create demo school: ${schoolErr.message}`);
    console.log(`[seed] Created school ${schoolId}`);
  }

  // Ensure a trialing school_license so enrollment trigger doesn't block inserts
  try {
    const trialEnd = new Date(now.getTime() + 365 * 86_400_000);
    await admin.from('school_licenses').upsert(
      {
        school_id: schoolId,
        tier: 'professional',
        status: 'trialing',
        student_limit: 300,
        trial_starts_at: now.toISOString(),
        trial_ends_at: trialEnd.toISOString(),
        trial_converted: false,
      },
      { onConflict: 'school_id' }
    );
  } catch (e) {
    console.warn('[seed] school_licenses upsert failed (soft):', (e as Error).message);
  }

  // ── Step 2: Ensure teacher (HARD FAIL) ───────────────────────────────────
  console.log('[seed] Ensuring teacher…');
  const teacherEmail = `${DEMO_TEACHER.key}@demo.coreedtech.com`;
  const teacherId = await ensureAuthUser({
    admin,
    email: teacherEmail,
    password: DEMO_PASSWORD,
    full_name: DEMO_TEACHER.full_name,
    role: DEMO_TEACHER.role,
    school_id: schoolId,
  });
  console.log(`[seed] Teacher id: ${teacherId}`);

  // ── Step 3: Ensure parent + admin (soft fail) ────────────────────────────
  let parentId: string | null = null;
  let adminId: string | null = null;

  try {
    parentId = await ensureAuthUser({
      admin,
      email: `${DEMO_PARENT.key}@demo.coreedtech.com`,
      password: DEMO_PASSWORD,
      full_name: DEMO_PARENT.full_name,
      role: DEMO_PARENT.role,
      school_id: schoolId,
    });
    console.log(`[seed] Parent id: ${parentId}`);
  } catch (e) {
    console.warn('[seed] parent creation failed (soft):', (e as Error).message);
  }

  try {
    adminId = await ensureAuthUser({
      admin,
      email: `${DEMO_ADMIN.key}@demo.coreedtech.com`,
      password: DEMO_PASSWORD,
      full_name: DEMO_ADMIN.full_name,
      role: DEMO_ADMIN.role,
      school_id: schoolId,
    });
    console.log(`[seed] Admin id: ${adminId}`);
  } catch (e) {
    console.warn('[seed] admin creation failed (soft):', (e as Error).message);
  }

  // ── Step 4: Ensure 8 students (soft fail) ────────────────────────────────
  const studentIds: Record<string, string> = {};

  for (const student of DEMO_STUDENTS) {
    try {
      const sid = await ensureAuthUser({
        admin,
        email: `${student.key}@demo.coreedtech.com`,
        password: DEMO_PASSWORD,
        full_name: student.full_name,
        role: 'student',
        school_id: schoolId,
      });
      studentIds[student.key] = sid;
      console.log(`[seed] Student ${student.key}: ${sid}`);
    } catch (e) {
      console.warn(`[seed] student ${student.key} failed (soft):`, (e as Error).message);
    }
  }

  // ── Step 5: Link parent → Alex (soft fail) ───────────────────────────────
  const alexId = studentIds['alex'];
  if (parentId && alexId) {
    try {
      await admin.from('users').update({ parent_id: parentId }).eq('id', alexId);
      await admin.from('guardians').upsert(
        { parent_id: parentId, student_id: alexId },
        { onConflict: 'parent_id,student_id' }
      );
      console.log('[seed] Linked parent → Alex');
    } catch (e) {
      console.warn('[seed] guardian link failed (soft):', (e as Error).message);
    }
  }

  // ── Step 6: Ensure class (soft fail) ─────────────────────────────────────
  let classId: string | null = null;
  try {
    const { data: existingClass } = await admin
      .from('classes')
      .select('id')
      .eq('name', CLASS_NAME)
      .eq('teacher_id', teacherId)
      .maybeSingle();

    if (existingClass) {
      classId = existingClass.id;
    } else {
      classId = randomUUID();
      const { error } = await admin.from('classes').insert({
        id: classId,
        school_id: schoolId,
        teacher_id: teacherId,
        name: CLASS_NAME,
        subject: 'General',
        grade_level: '8',
        is_active: true,
      });
      if (error) throw error;
    }
    console.log(`[seed] Class id: ${classId}`);
  } catch (e) {
    console.warn('[seed] class creation failed (soft):', (e as Error).message);
  }

  // ── Step 7: Enrollments (soft fail) ──────────────────────────────────────
  if (classId) {
    for (const [key, sid] of Object.entries(studentIds)) {
      try {
        await admin.from('enrollments').upsert(
          { class_id: classId, student_id: sid, is_active: true },
          { onConflict: 'class_id,student_id' }
        );
      } catch (e) {
        console.warn(`[seed] enrollment ${key} failed (soft):`, (e as Error).message);
      }
    }
    console.log('[seed] Enrollments done');
  }

  // ── Step 8: Skills — pre-query insert-if-absent (no ON CONFLICT) ─────────
  let skillId: string | null = null;
  try {
    skillId = await ensureSkill({
      school_id: schoolId,
      slug: 'demo-skill-1',
      name: 'Core Concept Analysis',
      subject: null,
    });
    console.log(`[seed] Skill id: ${skillId}`);
  } catch (e) {
    console.warn('[seed] skill creation failed (soft):', (e as Error).message);
  }

  // ── Step 9: Lesson (soft fail) ────────────────────────────────────────────
  let lessonId: string | null = null;
  if (classId) {
    try {
      const { data: existingLesson } = await admin
        .from('lessons')
        .select('id')
        .eq('title', 'Demo Lesson')
        .eq('teacher_id', teacherId)
        .maybeSingle();

      if (existingLesson) {
        lessonId = existingLesson.id;
      } else {
        lessonId = randomUUID();
        const { error } = await admin.from('lessons').insert({
          id: lessonId,
          class_id: classId,
          teacher_id: teacherId,
          title: 'Demo Lesson',
          status: 'published',
          parsed_content: { summary: 'Demo lesson content for CORE v2 seed.' },
        });
        if (error) throw error;
      }
      console.log(`[seed] Lesson id: ${lessonId}`);
    } catch (e) {
      console.warn('[seed] lesson creation failed (soft):', (e as Error).message);
    }
  }

  // ── Step 10: Quiz + quiz questions (soft fail) ───────────────────────────
  let quizId: string | null = null;
  const questionIds: string[] = [];

  if (classId && lessonId) {
    try {
      const { data: existingQuiz } = await admin
        .from('quizzes')
        .select('id')
        .eq('lesson_id', lessonId)
        .eq('status', 'published')
        .maybeSingle();

      if (existingQuiz) {
        quizId = existingQuiz.id;
      } else {
        quizId = randomUUID();
        const { error } = await admin.from('quizzes').insert({
          id: quizId,
          lesson_id: lessonId,
          class_id: classId,
          teacher_id: teacherId,
          title: 'Demo Quiz',
          status: 'published',
          published_at: now.toISOString(),
        });
        if (error) throw error;
      }
      console.log(`[seed] Quiz id: ${quizId}`);

      // 5 quiz questions (question_type ∈ {mcq,open,numeric})
      const QUESTION_DEFS = [
        { position: 1, question_type: 'mcq',     question_text: 'Which best describes the main concept?' },
        { position: 2, question_type: 'open',    question_text: 'Explain the concept in your own words.' },
        { position: 3, question_type: 'numeric', question_text: 'Calculate the result given the values.' },
        { position: 4, question_type: 'mcq',     question_text: 'Which example demonstrates the concept?' },
        { position: 5, question_type: 'open',    question_text: 'Describe a real-world application.' },
      ];

      // Check if questions already exist
      const { data: existingQs } = await admin
        .from('quiz_questions')
        .select('id')
        .eq('quiz_id', quizId);

      if (!existingQs || existingQs.length === 0) {
        for (const qDef of QUESTION_DEFS) {
          const qid = randomUUID();
          const { error: qErr } = await admin.from('quiz_questions').insert({
            id: qid,
            quiz_id: quizId,
            position: qDef.position,
            question_type: qDef.question_type,
            question_text: qDef.question_text,
            skill_id: skillId ?? undefined,
          });
          if (qErr) {
            console.warn(`[seed] quiz question ${qDef.position} failed (soft):`, qErr.message);
          } else {
            questionIds.push(qid);
          }
        }
      } else {
        questionIds.push(...(existingQs.map((q: { id: string }) => q.id)));
      }
      console.log(`[seed] Quiz questions: ${questionIds.length}`);
    } catch (e) {
      console.warn('[seed] quiz creation failed (soft):', (e as Error).message);
    }
  }

  // ── Step 11: Build seed rows + resolve keys → UUIDs ──────────────────────
  const seedRows = buildSeedRows(DEMO_STUDENTS, now);

  // ── Step 12: Quiz attempts (soft fail) ────────────────────────────────────
  if (quizId) {
    const qaIdMap: Record<string, Record<string, string>> = {}; // student_key → assignment_key → attempt_id (unused here but placeholder)

    for (const qa of seedRows.quiz_attempts) {
      const sid = studentIds[qa.student_key];
      if (!sid) continue;
      try {
        // Check for existing complete attempt
        const { data: existing } = await admin
          .from('quiz_attempts')
          .select('id')
          .eq('quiz_id', quizId)
          .eq('student_id', sid)
          .eq('is_complete', true)
          .maybeSingle();

        if (existing) continue;

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
        console.warn(`[seed] quiz_attempt ${qa.student_key} failed (soft):`, (e as Error).message);
      }
    }
    console.log('[seed] Quiz attempts done');
  }

  // ── Step 13: Assignments + homework_attempts (soft fail) ─────────────────
  const assignmentIds: Record<string, string> = {};

  if (classId) {
    for (const assignment of seedRows.assignments) {
      for (const student of DEMO_STUDENTS) {
        const sid = studentIds[student.key];
        if (!sid) continue;

        // Determine mastery_band from student
        const band: 'reteach' | 'grade_level' | 'advanced' =
          student.expect.band === 'advanced' ? 'advanced'
          : student.expect.band === 'reteach' ? 'reteach'
          : 'grade_level';

        const assignmentKey = `${assignment.key}:${student.key}`;

        try {
          // Check existing
          const { data: existingA } = await admin
            .from('assignments')
            .select('id')
            .eq('student_id', sid)
            .eq('class_id', classId)
            .eq('due_at', assignment.due_at)
            .maybeSingle();

          let aId: string;
          if (existingA) {
            aId = existingA.id;
          } else {
            aId = randomUUID();
            const { error: aErr } = await admin.from('assignments').insert({
              id: aId,
              student_id: sid,
              class_id: classId,
              lesson_id: lessonId ?? undefined,
              mastery_band: band,
              content: {
                bandLabel: band,
                instructions: (assignment.content.tasks as Array<{ type: string; prompt: string }>)
                  ? assignment.content.instructions
                  : 'Complete the following tasks.',
                tasks: assignment.content.tasks,
              },
              status: 'published',
              due_at: assignment.due_at,
              skill_ids: skillId ? [skillId] : [],
              reteach_needed: student.reteachNeeded ?? false,
            });
            if (aErr) throw aErr;
          }
          assignmentIds[assignmentKey] = aId;
        } catch (e) {
          console.warn(`[seed] assignment ${assignmentKey} failed (soft):`, (e as Error).message);
        }
      }
    }
    console.log('[seed] Assignments done');

    // Homework attempts
    for (const attempt of seedRows.homework_attempts) {
      const sid = studentIds[attempt.student_key];
      if (!sid) continue;

      const assignmentKey = `${attempt.assignment_key}:${attempt.student_key}`;
      const aId = assignmentIds[assignmentKey];
      if (!aId) continue;

      try {
        // Check existing
        const { data: existingH } = await admin
          .from('homework_attempts')
          .select('id')
          .eq('assignment_id', aId)
          .eq('student_id', sid)
          .maybeSingle();

        if (existingH) continue;

        const hw: Record<string, unknown> = {
          assignment_id: aId,
          student_id: sid,
          status: attempt.status,
          score_pct: attempt.score_pct,
          submitted_at: attempt.submitted_at,
          responses: attempt.responses,
          effort_label: attempt.effort_label ?? null,
          allow_redo: attempt.allow_redo ?? false,
          is_redo: attempt.is_redo ?? false,
          flagged_by: attempt.flagged_by ?? null,
        };
        if (attempt.graded_at) hw.graded_at = attempt.graded_at;

        const { error: hErr } = await admin.from('homework_attempts').insert(hw);
        if (hErr) {
          console.warn(`[seed] homework_attempt ${attempt.student_key}/${attempt.assignment_key} failed (soft):`, hErr.message);
        }
      } catch (e) {
        console.warn(`[seed] homework_attempt ${attempt.student_key}/${attempt.assignment_key} failed (soft):`, (e as Error).message);
      }
    }
    console.log('[seed] Homework attempts done');
  }

  // ── Step 14: Student model snapshots (soft fail) ─────────────────────────
  for (const snap of seedRows.snapshots) {
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
      console.warn(`[seed] snapshot ${snap.student_key}/${snap.snapshot_date} failed (soft):`, (e as Error).message);
    }
  }
  console.log('[seed] Snapshots done');

  // ── Step 15: Skill learning state (soft fail) ─────────────────────────────
  if (skillId) {
    for (const sls of seedRows.skill_learning_state) {
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

        await admin.from('skill_learning_state').upsert(row, {
          onConflict: 'student_id,skill_id',
        });
      } catch (e) {
        console.warn(`[seed] skill_learning_state ${sls.student_key} failed (soft):`, (e as Error).message);
      }
    }
    console.log('[seed] Skill learning states done');
  }

  // ── Step 16: Misconception observations (soft fail) ───────────────────────
  if (skillId) {
    for (const m of seedRows.misconceptions) {
      const sid = studentIds[m.student_key];
      if (!sid) continue;
      try {
        await admin.from('misconception_observations').insert({
          student_id: sid,
          skill_id: skillId,
          school_id: schoolId,
          error_type: m.error_type,
          reasoning_pattern: m.reasoning_pattern,
          observed_at: m.observed_at,
        });
      } catch (e) {
        console.warn(`[seed] misconception ${m.student_key} failed (soft):`, (e as Error).message);
      }
    }
    console.log('[seed] Misconceptions done');
  }

  console.log('[seed] Demo seed complete.');
  console.log(`[seed] School: ${schoolId}`);
  console.log(`[seed] Teacher: ${teacherId}`);
  console.log(`[seed] Students seeded: ${Object.keys(studentIds).length}`);
}

main().catch(err => {
  console.error('[seed] Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
