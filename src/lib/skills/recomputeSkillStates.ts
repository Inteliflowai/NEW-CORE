// ============================================================
// src/lib/skills/recomputeSkillStates.ts
// Phase 3 — DB orchestrator for the Can't-vs-Time fusion.
//
// Gathers per-skill observations for one student and runs the pure
// computeSkillState() fusion, upserting skill_learning_state rows.
//
// Called (fail-soft, fire-and-forget) from the submit route after
// grading_status:'complete' is written.
//
// NEVER throws — returns a summary; callers log or ignore it.
//
// C10: reads ONLY real columns verified against migrations 0003-0011.
//      NO phantom columns (no grade, no reteach_completed_at, no
//      cognitive_signals table).
// C11: object signature { studentId, schoolId, skillIds? }.
// C19: sessionErrorPatterns via toSessionErrorPattern from graded-OEQ
//      grading_output only.
// C20: OEQ correctness = ai_score >= 0.5; MCQ = is_correct === true.
//      Both gathered without is_correct IS NOT NULL filter (drops OEQ).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  computeSkillState,
  type SkillStateInput,
  type SkillQuizObservation,
  type SkillHomeworkObservation,
  type SkillReteachEvent,
} from './computeSkillState';
import { toSessionErrorPattern } from './errorPatternMap';

// ── Return type ──────────────────────────────────────────────────────────────

export interface SkillStateRecomputeSummary {
  ok: boolean;
  reason?: string;
  skillsRecomputed: number;
  states: Record<string, string>; // skill_id → state (for logging)
}

// ── Row shapes (ONLY real columns from migrations 0003-0011) ─────────────────

interface QuizResponseRow {
  // from quiz_responses (0003 + 0010 grading_output)
  is_correct: boolean | null;           // MCQ/numeric: set; OEQ: null (C20)
  ai_score: number | null;              // OEQ: grader score 0-1; MCQ: null
  question_type_scored: string | null;  // 'mcq'|'numeric'|'open'
  grading_output: {                     // jsonb — OEQ cognitive taxonomy (C3/C10)
    error_type?: string | null;
    reasoning_pattern?: string | null;
  } | null;
  // joined relations
  quiz_questions: { skill_id: string | null } | null;
  quiz_attempts: {
    student_id: string;
    is_complete: boolean;
    submitted_at: string | null;
  } | null;
}

interface AssignmentRow {
  // from assignments (0004 + 0005 skill_ids)
  id: string;
  skill_ids: string[] | null;           // uuid[] added in 0005
  reteach_needed: boolean | null;       // 0004
  created_at: string;
}

interface HwAttemptRow {
  // from homework_attempts (0004 + 0011 effort_label/redo flags)
  assignment_id: string;
  student_id: string;
  status: string | null;
  score_pct: number | null;             // 0004 — gradePct fallback
  teacher_score: number | null;         // 0004 — gradePct preferred
  effort_label: string | null;          // 0011
  allow_redo: boolean | null;           // 0011
  is_redo: boolean | null;              // 0011 — redo flag
  flagged_by: string | null;            // 0011 — 'reteach' if teacher flagged
  submitted_at: string | null;
  graded_at: string | null;
}

// ── Main export (C11 object signature) ───────────────────────────────────────

export async function recomputeSkillStatesForStudent(
  admin: SupabaseClient,
  args: {
    studentId: string;
    schoolId: string | null;
    /** Limit recompute to these skills. Omit = all touched skills. */
    skillIds?: string[];
  },
): Promise<SkillStateRecomputeSummary> {
  const { studentId } = args;

  try {
    // ── 0. Resolve school_id — never write null (RLS: school_id = get_my_school_id()) ──
    // When caller passes null (e.g. submit hook), resolve from users.school_id so
    // skill_learning_state rows remain visible to teacher RLS (migration 0011).
    let schoolId = args.schoolId;
    if (schoolId == null) {
      const { data: userData } = await admin
        .from('users')
        .select('school_id')
        .eq('id', studentId)
        .single();
      schoolId = userData?.school_id ?? null;
    }

    // ── 1. Quiz responses: both MCQ (is_correct) and OEQ (ai_score) ──────────
    // C20: do NOT filter .not('is_correct','is',null) — that drops OEQ rows.
    // We gather ALL graded responses; correctness is derived per-row below.
    const { data: respData, error: respErr } = await admin
      .from('quiz_responses')
      .select(
        'is_correct, ai_score, question_type_scored, grading_output, ' +
        'quiz_questions!inner(skill_id), ' +
        'quiz_attempts!inner(student_id, is_complete, submitted_at)',
      )
      .eq('quiz_attempts.student_id', studentId)
      .eq('quiz_attempts.is_complete', true)
      .not('quiz_questions.skill_id', 'is', null)
      .limit(2000);

    if (respErr) {
      console.error('[recomputeSkillStates] quiz_responses query error:', {
        message: respErr.message,
        code: respErr.code,
      });
    }

    const responses = (respData ?? []) as unknown as QuizResponseRow[];

    // Build per-skill quiz observations + per-skill session error patterns.
    // C20: MCQ → is_correct===true; OEQ → ai_score >= 0.5.
    // C19: sessionErrorPatterns ONLY from graded-OEQ grading_output.
    const quizBySkill = new Map<string, SkillQuizObservation[]>();
    const errorPatternsBySkill = new Map<string, string[]>();

    for (const r of responses) {
      const skillId = r.quiz_questions?.skill_id;
      if (!skillId) continue;

      const occurredAt = r.quiz_attempts?.submitted_at ?? '';
      const qtype = r.question_type_scored;

      // C20: derive correctness
      let isCorrect: boolean;
      if (qtype === 'open') {
        // OEQ: ai_score >= 0.5 counts as correct
        isCorrect = (r.ai_score ?? 0) >= 0.5;
      } else {
        // MCQ / numeric: is_correct column
        isCorrect = r.is_correct === true;
      }

      if (!quizBySkill.has(skillId)) quizBySkill.set(skillId, []);
      quizBySkill.get(skillId)!.push({ isCorrect, occurredAt });

      // C19: session error patterns from graded-OEQ grading_output only
      if (qtype === 'open' && r.grading_output) {
        const pattern = toSessionErrorPattern(r.grading_output);
        if (pattern !== null) {
          if (!errorPatternsBySkill.has(skillId)) errorPatternsBySkill.set(skillId, []);
          errorPatternsBySkill.get(skillId)!.push(pattern);
        }
      }
    }

    // ── 2. Assignments: gather skill_ids for homework lookup ─────────────────
    // C10: assignments columns from 0004 + skill_ids from 0005.
    // NO reteach_completed_at (phantom column).
    const { data: asgData, error: asgErr } = await admin
      .from('assignments')
      .select('id, skill_ids, reteach_needed, created_at')
      .eq('student_id', studentId)
      .limit(1000);

    if (asgErr) {
      console.error('[recomputeSkillStates] assignments query error:', {
        message: asgErr.message,
        code: asgErr.code,
      });
    }

    const assignments = ((asgData ?? []) as unknown as AssignmentRow[]).filter(
      (a) => Array.isArray(a.skill_ids) && a.skill_ids.length > 0,
    );

    // ── 3. Homework attempts: gather per-assignment ───────────────────────────
    // C10: homework_attempts columns from 0004 + effort_label/redo from 0011.
    // gradePct = teacher_score ?? score_pct (NO phantom `grade` column).
    const attemptsByAssignment = new Map<string, HwAttemptRow[]>();

    if (assignments.length > 0) {
      const { data: hwData, error: hwErr } = await admin
        .from('homework_attempts')
        .select(
          'assignment_id, student_id, status, score_pct, teacher_score, ' +
          'effort_label, allow_redo, is_redo, flagged_by, submitted_at, graded_at',
        )
        .eq('student_id', studentId)
        .in(
          'assignment_id',
          assignments.map((a) => a.id),
        );

      if (hwErr) {
        console.error('[recomputeSkillStates] homework_attempts query error:', {
          message: hwErr.message,
          code: hwErr.code,
        });
      }

      for (const h of (hwData ?? []) as unknown as HwAttemptRow[]) {
        if (!attemptsByAssignment.has(h.assignment_id)) {
          attemptsByAssignment.set(h.assignment_id, []);
        }
        attemptsByAssignment.get(h.assignment_id)!.push(h);
      }
    }

    // Build per-skill homework + reteach maps.
    const hwBySkill = new Map<string, SkillHomeworkObservation[]>();
    const reteachBySkill = new Map<string, SkillReteachEvent>();

    for (const a of assignments) {
      const attempts = attemptsByAssignment.get(a.id) ?? [];

      // Graded attempt: status must be 'graded' — submitted/in_progress attempts
      // do not yet have a usable grade; they are only used for the submitted flag.
      const graded = attempts.find(
        (h) =>
          h.status === 'graded' &&
          (typeof h.teacher_score === 'number' || typeof h.score_pct === 'number'),
      );

      const submitted = attempts.some(
        (h) =>
          h.status === 'graded' ||
          h.status === 'submitted' ||
          h.submitted_at != null,
      );

      // C10: gradePct = teacher_score ?? score_pct (no phantom `grade`)
      const gradePct =
        graded
          ? (typeof graded.teacher_score === 'number'
              ? graded.teacher_score
              : graded.score_pct ?? null)
          : null;

      const obs: SkillHomeworkObservation = {
        gradePct,
        submitted,
        occurredAt:
          graded?.graded_at ??
          graded?.submitted_at ??
          a.created_at,
        effortLabel: graded?.effort_label ?? null,
      };

      // C10: reteach derived from redo flags — NO reteach_completed_at column.
      // A graded redo attempt (is_redo=true) on this assignment = reteach completion.
      // type: 'different_approach' if flagged_by reteach | reteach_needed=true;
      //       'more_practice' for a plain allow_redo redo.
      // If completedAt not determinable → pass reteach: null (computeSkillState handles null).
      const redoAttempt = attempts.find(
        (h) =>
          h.is_redo === true &&
          (h.status === 'graded' || h.submitted_at != null),
      );

      let reteach: SkillReteachEvent | null = null;
      if (redoAttempt && (redoAttempt.submitted_at ?? redoAttempt.graded_at)) {
        const completedAt =
          redoAttempt.graded_at ?? redoAttempt.submitted_at!;
        const isDifferentApproach =
          a.reteach_needed === true ||
          redoAttempt.flagged_by === 'reteach';
        reteach = {
          type: isDifferentApproach ? 'different_approach' : 'more_practice',
          completedAt,
        };
      }

      for (const skillId of a.skill_ids!) {
        if (!hwBySkill.has(skillId)) hwBySkill.set(skillId, []);
        hwBySkill.get(skillId)!.push(obs);

        if (reteach) {
          const prev = reteachBySkill.get(skillId);
          if (!prev || prev.completedAt < reteach.completedAt) {
            reteachBySkill.set(skillId, reteach);
          }
        }
      }
    }

    // ── 4. Determine which skills to recompute ────────────────────────────────
    // skillIds provided → always recompute those (even if zero observations
    // → honest insufficient_data / not_attempted result).
    // No skillIds → sweep all touched skills.
    const touched = new Set<string>([
      ...quizBySkill.keys(),
      ...hwBySkill.keys(),
    ]);
    const targets: string[] =
      args.skillIds?.length ? args.skillIds : Array.from(touched);

    // ── 5. Fuse + upsert ─────────────────────────────────────────────────────
    const states: Record<string, string> = {};

    for (const skillId of targets) {
      // C19: session error patterns for this skill (from OEQ grading_output via map)
      const sessionErrorPatterns = errorPatternsBySkill.get(skillId) ?? [];

      const input: SkillStateInput = {
        quiz: quizBySkill.get(skillId) ?? [],
        homework: hwBySkill.get(skillId) ?? [],
        sessionErrorPatterns,
        reteach: reteachBySkill.get(skillId) ?? null,
        spark: [], // SPARK webhook is Plan 6; always empty here
      };

      const fused = computeSkillState(input);
      states[skillId] = fused.state;

      // C11: upsert with school_id from args
      const { error: upErr } = await admin
        .from('skill_learning_state')
        .upsert(
          {
            student_id: studentId,
            school_id: schoolId,
            skill_id: skillId,
            state: fused.state,
            confidence: fused.confidence,
            observation_count: fused.observationCount,
            evidence: fused.evidence,
            last_reteach_outcome: fused.lastReteachOutcome,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'student_id,skill_id' },
        );

      if (upErr) {
        console.warn(
          '[recomputeSkillStates] upsert skipped:',
          upErr.code,
          upErr.message,
        );
        return { ok: false, reason: 'upsert_failed', skillsRecomputed: 0, states };
      }
    }

    return { ok: true, skillsRecomputed: targets.length, states };
  } catch (err) {
    console.error('[recomputeSkillStates] Non-blocking error:', err);
    return { ok: false, reason: 'exception', skillsRecomputed: 0, states: {} };
  }
}
