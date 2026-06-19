// src/app/api/teacher/student/[studentId]/signals/route.ts
// GET /api/teacher/student/[studentId]/signals
//
// One-student signal bundle for the teacher view (Plan 3 Task 16 read API).
//
// Auth flow:
//   1. auth.getUser() → 401 if not authenticated
//   2. C8 STAFF ROLE GATE: 403 unless teacher|school_admin|school_sysadmin|platform_admin
//      (student/parent must not reach teacher-only tables)
//   3. guardStudentAccess(studentId) → 403 if IDOR
//
// Returns: current_band, per_skill_cl (CL_VERB_BY_STATE; null → "Not yet assessed"),
//          confidence as SOFT WORDS (not numbers), recurring misconceptions per skill,
//          divergence, effort pattern, roster risk, LIVE session risk (C3),
//          reteach outcomes, trajectory derived from snapshots (C3).
//
// C14: SELECT id + is_correct + telemetry columns explicitly.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardStudentAccess } from '@/lib/auth/guards';
import { CL_VERB_BY_STATE } from '@/lib/skills/clVerbs';
import type { SkillLearningState } from '@/lib/skills/clVerbs';
import { currentMasteryBand } from '@/lib/utils/scoring';
import { computeHwQuizDivergence } from '@/lib/signals/computeHwQuizDivergence';
import { computeRosterRiskIndex } from '@/lib/signals/computeRosterRiskIndex';
import { computeSessionRisk } from '@/lib/signals/computeSessionRisk';
import { findRecurringError } from '@/lib/signals/diagnosis';
import { detectCompletedReteachCycles } from '@/lib/signals/computeReteachEffectiveness';
import { computeConsistency, computeTrajectory } from '@/lib/signals/consistency';

/** Staff roles that are allowed to see teacher-facing signal data. */
const STAFF_ROLES = new Set(['teacher', 'school_admin', 'school_sysadmin', 'platform_admin']);

/** Confidence score → soft human-readable label (teacher-facing; no raw numbers). */
function confidenceSoftLabel(confidence: number | null): string {
  if (confidence == null) return 'unknown';
  if (confidence >= 70) return 'consistent';
  if (confidence >= 40) return 'tentative';
  return 'emerging';
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ studentId: string }> },
): Promise<NextResponse> {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 2. C8 STAFF ROLE GATE (BEFORE object guard) ────────────────────────────
  // Resolve role from users table; 403 any non-staff caller.
  const { data: callerProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();
  const callerRole = callerProfile?.role ?? null;
  if (!callerRole || !STAFF_ROLES.has(callerRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { studentId } = await params;

  // ── 3. Object-level IDOR guard ─────────────────────────────────────────────
  const guard = await guardStudentAccess(studentId);
  if (guard) return guard;

  const admin = createAdminSupabaseClient();

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

  type SkillRow = { skill: { id: string; name: string } | { id: string; name: string }[] | null; state: string; confidence: number | null };
  const per_skill_cl = (skillStates ?? [] as unknown[]).map((rawRow) => {
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
  for (const m of (misconceptions ?? [])) {
    const sid = (m as { skill_id: string }).skill_id;
    if (!bySkill[sid]) bySkill[sid] = [];
    bySkill[sid].push((m as { error_type: string }).error_type);
  }
  const recurring_misconceptions = Object.entries(bySkill)
    .map(([skill_id, errorTypes]) => ({
      skill_id,
      recurring_error: findRecurringError(errorTypes),
    }))
    .filter((r) => r.recurring_error != null);

  // ── Homework attempts ───────────────────────────────────────────────────────
  const { data: hwAttempts } = await admin
    .from('homework_attempts')
    .select('id, score_pct, teli_hint_count, effort_label, submitted_at, allow_redo, is_redo, assignment_id, student_id, flagged_by, created_at')
    .eq('student_id', studentId)
    .order('submitted_at', { ascending: false })
    .limit(20);

  const hwScores = (hwAttempts ?? [])
    .map((r: { score_pct: number | null }) => r.score_pct)
    .filter((s): s is number => s != null);

  // ── Divergence ──────────────────────────────────────────────────────────────
  const divergence = computeHwQuizDivergence({
    homeworkScores: (hwAttempts ?? []).map((r: { score_pct: number | null }) => r.score_pct ?? null),
    quizScores: (quizAttempts ?? []).map((r: { score_pct: number | null }) => (r as { score_pct: number | null }).score_pct ?? null),
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
      homeworkAttempts: (hwAttempts ?? []).map((r: {
        score_pct: number | null;
        submitted_at: string | null;
        allow_redo: boolean;
        is_redo: boolean;
      }) => ({
        score: r.score_pct ?? null,
        submitted_at: r.submitted_at ?? null,
        allow_redo: r.allow_redo ?? false,
        is_redo: r.is_redo ?? false,
      })),
      quizAttempts: (quizAttempts ?? []).map((r: {
        score_pct: number | null;
        submitted_at: string | null;
      }) => ({
        score: r.score_pct ?? null,
        submitted_at: r.submitted_at ?? null,
      })),
      totalAssigned: (hwAttempts ?? []).length,
    },
    new Date(),
  );

  // ── Session risk — LIVE from latest attempt's quiz_responses (C3) ───────────
  // C14: SELECT id on quiz_attempts (done above); SELECT is_correct + telemetry columns
  const latestAttemptId = ((quizAttempts ?? []) as Array<{ id?: string }>)[0]?.id ?? '';
  let session_risk: { score: number; factors: string[] } = { score: 0, factors: [] };
  if (latestAttemptId) {
    const { data: quizResponses } = await admin
      .from('quiz_responses')
      .select('id, is_correct, response_time_ms, hesitation_ms, answer_changes, navigation_backs, pause_count, total_pause_ms, word_count')
      .eq('attempt_id', latestAttemptId);
    session_risk = computeSessionRisk(quizResponses ?? []);
  }

  // ── Reteach outcomes ─────────────────────────────────────────────────────────
  const reteach_outcomes = detectCompletedReteachCycles(
    (hwAttempts ?? []).map((r: {
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
    })),
    new Set<string>(),
  );

  // ── Trajectory derived from snapshots (C3: NOT a snapshot column, derived on read) ──
  // Read student_model_snapshots to get avg_score history oldest→newest
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

  return NextResponse.json({
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
  });
}
