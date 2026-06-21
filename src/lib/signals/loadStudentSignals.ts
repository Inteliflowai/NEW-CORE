// src/lib/signals/loadStudentSignals.ts
//
// Extracted data layer for the per-student signals endpoint.
// Call this from the route GET (thin wrapper) or directly from a Server Component
// page to avoid an internal HTTP hop.
//
// Auth + IDOR guarding is the CALLER's responsibility — this fn assumes the admin
// client and a guarded studentId. It performs NO auth.
//
// Exports the result types so downstream tasks (the One-Student page) can import
// them by name.

import type { SupabaseClient } from '@supabase/supabase-js';
import { coachObservation, type CoachObservation } from '@/lib/copy/coachObservation';
import type { ComputedSignals } from '@/lib/signals/behavioralTypes';
import { CL_VERB_BY_STATE } from '@/lib/skills/clVerbs';
import type { SkillLearningState } from '@/lib/skills/clVerbs';
import { currentMasteryBand } from '@/lib/utils/scoring';
import { computeHwQuizDivergence } from '@/lib/signals/computeHwQuizDivergence';
import type { DivergenceResult } from '@/lib/signals/computeHwQuizDivergence';
import { computeRosterRiskIndex } from '@/lib/signals/computeRosterRiskIndex';
import type { RiskResult } from '@/lib/signals/computeRosterRiskIndex';
import { computeSessionRisk } from '@/lib/signals/computeSessionRisk';
import { findRecurringError } from '@/lib/signals/diagnosis';
import { detectCompletedReteachCycles } from '@/lib/signals/computeReteachEffectiveness';
import type { ReteachCycleRecord } from '@/lib/signals/computeReteachEffectiveness';
import { computeConsistency, computeTrajectory } from '@/lib/signals/consistency';
import type { ConsistencyResult, TrajectoryResult } from '@/lib/signals/consistency';

// ── Confidence soft word (teacher-facing; no raw numbers) ─────────────────────
export type ConfidenceLabel = 'consistent' | 'tentative' | 'emerging' | 'unknown';

/** Confidence score → soft human-readable label (teacher-facing; no raw numbers). */
export function confidenceSoftLabel(confidence: number | null): ConfidenceLabel {
  if (confidence == null) return 'unknown';
  if (confidence >= 70) return 'consistent';
  if (confidence >= 40) return 'tentative';
  return 'emerging';
}

// ── Exported result types (the One-Student page imports these verbatim) ───────

export interface PerSkillCL {
  skill_id: string | null;
  skill_name: string;
  state: SkillLearningState;
  cl_verb: 'Reinforce' | 'On Track' | 'Enrich' | null;
  cl_display: string;
  confidence_label: ConfidenceLabel;
}

export interface RecurringMisconception {
  skill_id: string;
  recurring_error: { type: string; count: number } | null;
}

export type DivergenceWithFlag = DivergenceResult & { divergence_flagged: boolean };

export interface SessionRiskResult {
  score: number;
  factors: string[];
}

export interface StudentSignals {
  student_id: string;
  current_band: string | null;
  per_skill_cl: PerSkillCL[];
  recurring_misconceptions: RecurringMisconception[];
  divergence: DivergenceWithFlag;
  effort: { dominant_effort_pattern: string | null };
  risk: {
    roster: RiskResult;
    session: SessionRiskResult;
  };
  reteach_outcomes: ReteachCycleRecord[];
  trajectory: ConsistencyResult & TrajectoryResult;
  growth_history: number[];
  coach_read: CoachObservation;
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Fetch and compute the full one-student signal bundle.
 *
 * @param admin     Admin Supabase client (RLS-bypassed). Caller is responsible
 *                  for running the auth + IDOR guard BEFORE calling this.
 * @param studentId UUID of the student to load signals for.
 */
export async function loadStudentSignals(
  admin: SupabaseClient,
  studentId: string,
): Promise<StudentSignals> {
  // ── Quiz attempts → current band (C14: select id for latestAttemptId) ──────
  const { data: quizAttempts } = await admin
    .from('quiz_attempts')
    .select('id, mastery_band, submitted_at, created_at, is_complete, score_pct')
    .eq('student_id', studentId)
    .order('submitted_at', { ascending: false })
    .limit(20);

  const current_band = currentMasteryBand(quizAttempts ?? []);
  const quizScores = (quizAttempts ?? [])
    .map((r: { score_pct: number | null }) => r.score_pct)
    .filter((s): s is number => s != null);

  // ── Per-skill CL (skill_learning_state) ────────────────────────────────────
  const { data: skillStates } = await admin
    .from('skill_learning_state')
    .select('skill:skill_id(id, name), state, confidence')
    .eq('student_id', studentId);

  type SkillRow = {
    skill: { id: string; name: string } | { id: string; name: string }[] | null;
    state: string;
    confidence: number | null;
  };
  const per_skill_cl: PerSkillCL[] = (skillStates ?? ([] as unknown[])).map((rawRow) => {
    const row = rawRow as SkillRow;
    // Supabase may return the joined skill as an array (one-to-one FK with .select('...(...)'))
    const skillObj = Array.isArray(row.skill) ? row.skill[0] : row.skill;
    const state = row.state as SkillLearningState;
    const cl_verb = CL_VERB_BY_STATE[state] ?? null;
    return {
      skill_id: skillObj?.id ?? null,
      skill_name: skillObj?.name ?? 'Unknown',
      state,
      cl_verb,
      cl_display: cl_verb ?? 'Not yet assessed',
      // C correction: confidence as SOFT WORDS, never the raw 0-100 number
      confidence_label: confidenceSoftLabel(row.confidence),
    };
  });

  // ── Recurring misconceptions per skill ─────────────────────────────────────
  const { data: misconceptions } = await admin
    .from('misconception_observations')
    .select('skill_id, error_type, reasoning_pattern, observed_at')
    .eq('student_id', studentId);

  const bySkill: Record<string, string[]> = {};
  for (const m of misconceptions ?? []) {
    const sid = (m as { skill_id: string }).skill_id;
    if (!bySkill[sid]) bySkill[sid] = [];
    bySkill[sid].push((m as { error_type: string }).error_type);
  }
  const recurring_misconceptions: RecurringMisconception[] = Object.entries(bySkill)
    .map(([skill_id, errorTypes]) => ({
      skill_id,
      recurring_error: findRecurringError(errorTypes),
    }))
    .filter((r) => r.recurring_error != null);

  // ── Homework attempts ───────────────────────────────────────────────────────
  const { data: hwAttempts } = await admin
    .from('homework_attempts')
    .select(
      'id, score_pct, teli_hint_count, effort_label, submitted_at, allow_redo, is_redo, assignment_id, student_id, flagged_by, created_at',
    )
    .eq('student_id', studentId)
    .order('submitted_at', { ascending: false })
    .limit(20);

  // ── Divergence ──────────────────────────────────────────────────────────────
  const divergence = computeHwQuizDivergence({
    homeworkScores: (hwAttempts ?? []).map((r: { score_pct: number | null }) => r.score_pct ?? null),
    quizScores: (quizAttempts ?? []).map(
      (r: { score_pct: number | null }) => (r as { score_pct: number | null }).score_pct ?? null,
    ),
  });

  // ── Effort pattern (dominant from last 5 hw effort_labels) ─────────────────
  const effortLabels = (hwAttempts ?? [])
    .slice(0, 5)
    .map((r: { effort_label: string | null }) => r.effort_label)
    .filter((l): l is string => l != null);
  let dominant_effort_pattern: string | null = null;
  if (effortLabels.length > 0) {
    const counts: Record<string, number> = {};
    for (const l of effortLabels) counts[l] = (counts[l] ?? 0) + 1;
    dominant_effort_pattern = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  // ── Roster risk (C12: pass RAW attempt arrays + referenceDate) ──────────────
  const roster_risk = computeRosterRiskIndex(
    {
      homeworkAttempts: (hwAttempts ?? []).map(
        (r: {
          score_pct: number | null;
          submitted_at: string | null;
          allow_redo: boolean;
          is_redo: boolean;
        }) => ({
          score: r.score_pct ?? null,
          submitted_at: r.submitted_at ?? null,
          allow_redo: r.allow_redo ?? false,
          is_redo: r.is_redo ?? false,
        }),
      ),
      quizAttempts: (quizAttempts ?? []).map(
        (r: { score_pct: number | null; submitted_at: string | null }) => ({
          score: r.score_pct ?? null,
          submitted_at: r.submitted_at ?? null,
        }),
      ),
      totalAssigned: (hwAttempts ?? []).length,
    },
    new Date(),
  );

  // ── Session risk — LIVE from latest attempt's quiz_responses (C3) ───────────
  const latestAttemptId = ((quizAttempts ?? []) as Array<{ id?: string }>)[0]?.id ?? '';
  let session_risk: SessionRiskResult = { score: 0, factors: [] };
  if (latestAttemptId) {
    const { data: quizResponses } = await admin
      .from('quiz_responses')
      .select(
        'id, is_correct, response_time_ms, hesitation_ms, answer_changes, navigation_backs, pause_count, total_pause_ms, word_count',
      )
      .eq('attempt_id', latestAttemptId);
    session_risk = computeSessionRisk(quizResponses ?? []);
  }

  // ── Reteach outcomes ─────────────────────────────────────────────────────────
  const reteach_outcomes = detectCompletedReteachCycles(
    (hwAttempts ?? []).map(
      (r: {
        id: string;
        student_id: string;
        assignment_id: string;
        score_pct: number | null;
        allow_redo: boolean;
        is_redo: boolean;
        flagged_by: string | null;
        submitted_at: string | null;
        created_at: string;
      }) => ({
        id: r.id,
        student_id: r.student_id,
        assignment_id: r.assignment_id,
        score: r.score_pct ?? null,
        allow_redo: r.allow_redo ?? false,
        is_redo: r.is_redo ?? false,
        flagged_by: (r.flagged_by as 'auto' | 'teacher' | null) ?? null,
        submitted_at: r.submitted_at ?? null,
        created_at: r.created_at,
      }),
    ),
    new Set<string>(),
  );

  // ── Trajectory derived from snapshots (C3: NOT a snapshot column, derived on read) ──
  const { data: snapshots } = await admin
    .from('student_model_snapshots')
    .select('snapshot_date, avg_score')
    .eq('student_id', studentId)
    .order('snapshot_date', { ascending: true })
    .limit(8);

  const snapshotScores = (snapshots ?? [])
    .map((s: { avg_score: number | null }) => s.avg_score)
    .filter((s): s is number => s != null);

  // C6: lowerIsBetter=false for quiz/avg scores (higher = better)
  const trajectoryResult = computeTrajectory(snapshotScores, false);

  // ── Consistency from recent quiz scores ──────────────────────────────────────
  const consistency = computeConsistency(quizScores);

  // ── Coach read: the EMA behavioral model → ONE plain observation ──────────────
  // Server-side (Option-D): the raw model is translated to words here; only the
  // word-level CoachObservation crosses to the client.
  const { data: bsRow } = await admin
    .from('behavioral_signals')
    .select('computed, observation_count')
    .eq('student_id', studentId)
    .maybeSingle();

  const { data: nameRow } = await admin
    .from('users')
    .select('full_name')
    .eq('id', studentId)
    .maybeSingle();
  const firstName =
    ((nameRow as { full_name?: string | null } | null)?.full_name ?? '')
      .trim()
      .split(/\s+/)[0] || null;

  const coach_read = coachObservation({
    computed: (bsRow as { computed?: ComputedSignals | null } | null)?.computed ?? null,
    observationCount: (bsRow as { observation_count?: number } | null)?.observation_count ?? 0,
    firstName,
    rosterRisk: { risk_level: roster_risk.risk_level, risk_factors: roster_risk.risk_factors },
  });

  return {
    student_id: studentId,
    current_band,
    per_skill_cl,
    recurring_misconceptions,
    // FIX 1 (a2): include divergence_flagged boolean (floor=20, SCOPE §6) for Plan 4 consumers
    divergence: {
      ...divergence,
      divergence_flagged: divergence.divergence_score >= 20,
    },
    effort: { dominant_effort_pattern },
    risk: {
      roster: roster_risk,
      session: session_risk,
    },
    reteach_outcomes,
    trajectory: {
      ...consistency,
      ...trajectoryResult,
    },
    growth_history: snapshotScores,
    coach_read,
  };
}
