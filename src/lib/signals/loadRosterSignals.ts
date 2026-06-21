// src/lib/signals/loadRosterSignals.ts
//
// Extracted data layer for the roster-signals endpoint.
// Call this from the route GET (thin wrapper) or directly from a Server Component
// page to avoid an internal HTTP hop.
//
// Exports the result types so downstream tasks can import them by name.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MasteryBand } from '@/types/core';
import type { RiskResult } from '@/lib/signals/computeRosterRiskIndex';
import type { DiagnoseResult } from '@/lib/signals/diagnosis';

import { currentMasteryBand, bandIsVolatile } from '@/lib/utils/scoring';
import { computeRosterRiskIndex } from '@/lib/signals/computeRosterRiskIndex';
import { diagnose } from '@/lib/signals/diagnosis';
import type { DiagnoseInput } from '@/lib/signals/diagnosis';
import { detectConceptGaps } from '@/lib/signals/conceptGapDetector';
import { computeHwQuizDivergence } from '@/lib/signals/computeHwQuizDivergence';

// ── Exported types (other tasks import these verbatim) ────────────────────────

export interface RosterItem {
  student_id: string;
  full_name: string;
  band: MasteryBand | null;
  volatile: boolean;
  risk: RiskResult;
}

export interface FocusGroupItem {
  student_id: string;
  full_name: string;
  diagnosis: DiagnoseResult;
  // Structured signals for the humanized "why" sentence (teacher-only — never forward).
  divergence_score: number;
  hw_avg: number | null;
  quiz_avg: number | null;
}

export interface ConceptGapItem {
  question_index: number;
  question_text: string;   // opaque skill_id — kept but never rendered
  skill_name: string | null;
  pct_incorrect: number;
}

export interface RosterSignals {
  class_id: string;
  roster: RosterItem[];
  focus_group: FocusGroupItem[];
  concept_gaps: ConceptGapItem[];
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Fetch and compute all roster signals for a single class.
 *
 * @param admin  Admin Supabase client (RLS-bypassed). Caller is responsible
 *               for running the auth + IDOR guard BEFORE calling this.
 * @param classId UUID of the class to load signals for.
 */
export async function loadRosterSignals(
  admin: SupabaseClient,
  classId: string,
): Promise<RosterSignals> {
  // ── Enrolled students ───────────────────────────────────────────────────────
  const { data: enrollments } = await admin
    .from('enrollments')
    .select('student_id, users:student_id(id, full_name)')
    .eq('class_id', classId)
    .eq('is_active', true);

  type EnrollmentRow = {
    student_id: string;
    users: { id: string; full_name: string } | { id: string; full_name: string }[] | null;
  };
  const students = (enrollments ?? [] as unknown[]).map((raw) => {
    const e = raw as EnrollmentRow;
    const userObj = Array.isArray(e.users) ? e.users[0] : e.users;
    return {
      student_id: e.student_id,
      full_name: (userObj as { full_name?: string } | null | undefined)?.full_name ?? 'Student',
    };
  });

  // Fetch class misconceptions ONCE, up front — feeds BOTH per-student diagnosis
  // and the concept-gaps rail (no double query).
  const studentIds = students.map((s) => s.student_id);
  const { data: misconceptions } = await admin
    .from('misconception_observations')
    .select('student_id, skill_id, error_type')
    .in('student_id', studentIds.length > 0 ? studentIds : ['__none__']);

  const errorTypesByStudent = new Map<string, string[]>();
  for (const m of misconceptions ?? []) {
    const row = m as { student_id: string; error_type: string };
    const list = errorTypesByStudent.get(row.student_id) ?? [];
    list.push(row.error_type);
    errorTypesByStudent.set(row.student_id, list);
  }

  // ── Per-student signals ─────────────────────────────────────────────────────
  const rosterRaw = await Promise.all(
    students.map(async ({ student_id, full_name }) => {
      const { data: quizAttempts } = await admin
        .from('quiz_attempts')
        .select('mastery_band, submitted_at, created_at, is_complete, score_pct')
        .eq('student_id', student_id)
        .order('submitted_at', { ascending: false })
        .limit(10);

      const { data: hwAttempts } = await admin
        .from('homework_attempts')
        .select('score_pct, teli_hint_count, submitted_at, allow_redo, is_redo')
        .eq('student_id', student_id)
        .order('submitted_at', { ascending: false })
        .limit(10);

      const quizScores = (quizAttempts ?? [])
        .map((r: { score_pct: number | null }) => r.score_pct)
        .filter((s): s is number => s != null);
      const hwScores = (hwAttempts ?? [])
        .map((r: { score_pct: number | null }) => r.score_pct)
        .filter((s): s is number => s != null);

      const band = currentMasteryBand(quizAttempts ?? []);
      const volatile = bandIsVolatile(quizAttempts ?? []);

      const risk = computeRosterRiskIndex(
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

      const hwAvg = hwScores.length
        ? hwScores.reduce((a, b) => a + b, 0) / hwScores.length
        : null;
      const quizAvg = quizScores.length
        ? quizScores.reduce((a, b) => a + b, 0) / quizScores.length
        : null;

      const divergenceResult = computeHwQuizDivergence({
        homeworkScores: (hwAttempts ?? []).map((r: { score_pct: number | null }) => r.score_pct ?? null),
        quizScores: (quizAttempts ?? []).map((r: { score_pct: number | null }) => r.score_pct ?? null),
      });

      const diagnoseInput: DiagnoseInput = {
        divergence_score: divergenceResult.divergence_score,
        hw_avg: hwAvg,
        quiz_avg: quizAvg,
        error_types: errorTypesByStudent.get(student_id) ?? [],
      };

      const diagnosis = diagnose(diagnoseInput);

      return {
        student_id,
        full_name,
        band,
        volatile,
        risk,
        diagnosis,
        hw_avg: hwAvg,
        quiz_avg: quizAvg,
        divergence_score: divergenceResult.divergence_score,
      };
    }),
  );

  // ── Roster (strip internal diagnosis field) ─────────────────────────────────
  const roster: RosterItem[] = rosterRaw.map((r) => ({
    student_id: r.student_id,
    full_name: r.full_name,
    band: r.band,
    volatile: r.volatile,
    risk: r.risk,
  }));

  // ── Focus group ─────────────────────────────────────────────────────────────
  const focus_group: FocusGroupItem[] = rosterRaw
    .filter((r) => r.diagnosis != null)
    .map((r) => ({
      student_id: r.student_id,
      full_name: r.full_name,
      diagnosis: r.diagnosis as DiagnoseResult,
      divergence_score: r.divergence_score,
      hw_avg: r.hw_avg,
      quiz_avg: r.quiz_avg,
    }));

  // ── Class-wide concept gaps ─────────────────────────────────────────────────
  // `misconceptions` was already fetched above (before the per-student loop).
  const skillSet = new Set<string>();
  for (const m of (misconceptions ?? [])) {
    skillSet.add((m as { skill_id: string }).skill_id);
  }

  const skillIndexMap: Record<string, number> = {};
  let idx = 0;
  for (const sid of skillSet) {
    skillIndexMap[sid] = idx++;
  }

  const concept_gaps_raw = detectConceptGaps({
    questions: Array.from(skillSet).map((sid) => ({
      questionIndex: skillIndexMap[sid],
      questionText: sid,
    })),
    responses: (misconceptions ?? []).map((m: {
      student_id: string;
      skill_id: string;
      error_type: string;
    }) => ({
      studentId: m.student_id,
      questionIndex: skillIndexMap[m.skill_id] ?? 0,
      isCorrect: false,
    })),
  });

  // ── Resolve opaque skill_ids → human names for the concept-gap rail ──────────
  // (teacher-safe label; question_text is kept but never rendered verbatim)
  const gapSkillIds = Array.from(new Set(concept_gaps_raw.map((g) => g.question_text)));
  const nameById: Record<string, string> = {};
  if (gapSkillIds.length) {
    const { data: skillRows } = await admin
      .from('skills')
      .select('id, name')
      .in('id', gapSkillIds);
    for (const r of (skillRows ?? []) as { id: string; name: string }[]) {
      nameById[r.id] = r.name;
    }
  }

  const concept_gaps: ConceptGapItem[] = concept_gaps_raw.map((g) => ({
    question_index: g.question_index,
    question_text: g.question_text,           // opaque skill_id — kept but never rendered
    skill_name: nameById[g.question_text] ?? null,
    pct_incorrect: g.pct_incorrect,
  }));

  return { class_id: classId, roster, focus_group, concept_gaps };
}
