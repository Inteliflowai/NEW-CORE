// src/app/api/cron/weekly-snapshot/route.ts
// Plan 3 — weekly trajectory-snapshot cron. Replaces the 501 stub.
//
// Corrections applied: C3/C6/C11/C12/C15/C22/C23/C24
//
// Trigger: POST /api/cron/weekly-snapshot (also GET for Vercel probe)
//   Header: x-cron-secret: <CRON_SECRET env>
//   Query:  ?ref_date=YYYY-MM-DD  (optional; tests inject a fixed date;
//           defaults to today UTC when absent)
//
// Per active student, ORDERED:
//   1. recomputeSkillStatesForStudent({ studentId, schoolId }) — C11 object sig
//   2. roll up strength_topics / struggle_topics from skill_learning_state (AFTER step 1)
//   3. compute signal columns via libs
//   4. UPSERT student_model_snapshots ON CONFLICT(student_id, snapshot_date)
//      with snapshot_schema_version='v2'
//
// snapshot_date = ISO-week Monday (UTC) — deterministic, tested via isoWeekMonday()
// C15: improvement_4w = exact .eq('snapshot_date', date-28d) lookup, null when absent
// C22: consistency_score written
// C23: mastery_band = currentMasteryBand(quizRows) — quiz band, NOT computeSkillState
// C24: referenceDate injected into computeRosterRiskIndex (no bare Date.now())
// C3:  computeSessionRisk NOT called (per-attempt/live — not a snapshot column)
// Per-student failures isolated; summary returned.

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { recomputeSkillStatesForStudent } from '@/lib/skills/recomputeSkillStates';
import { computeConsistency } from '@/lib/signals/consistency';
import { computeHwQuizDivergence } from '@/lib/signals/computeHwQuizDivergence';
import { computeRosterRiskIndex } from '@/lib/signals/computeRosterRiskIndex';
import { currentMasteryBand } from '@/lib/utils/scoring';

// ── isoWeekMonday ─────────────────────────────────────────────────────────────

/**
 * Returns the ISO-week Monday (UTC) for the given reference date as YYYY-MM-DD.
 * Deterministic: no bare Date.now() — callers pass ref explicitly.
 *
 * ISO week: Monday = 1 … Sunday = 0.
 * Offset formula: dow === 0 (Sunday) → -6 days; else 1 − dow.
 */
export function isoWeekMonday(ref: Date): string {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  const dow = d.getUTCDay(); // 0=Sun … 6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// ── Row shapes ────────────────────────────────────────────────────────────────

interface QuizAttemptRow {
  score_pct: number | null;
  mastery_band: string | null;
  submitted_at: string | null;
  is_complete: boolean | null;
  created_at: string | null;
}

interface HomeworkAttemptRow {
  score_pct: number | null;
  teli_hint_count: number | null;
  effort_label: string | null;
  submitted_at: string | null;
  allow_redo: boolean | null;
  is_redo: boolean | null;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── CRON_SECRET gate ───────────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get('x-cron-secret');
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── snapshot_date: ISO-week Monday (UTC) ───────────────────────────────────
  // Accept ?ref_date=YYYY-MM-DD for deterministic tests; fall back to today UTC.
  const refParam = req.nextUrl.searchParams.get('ref_date');
  const refDate = refParam ? new Date(`${refParam}T00:00:00Z`) : new Date();
  const snapshotDate = isoWeekMonday(refDate);

  // ── prior snapshot date (exact 28 days back — C15) ────────────────────────
  const priorDateMs = new Date(`${snapshotDate}T00:00:00Z`).getTime() - 28 * 24 * 60 * 60 * 1000;
  const priorDateStr = new Date(priorDateMs).toISOString().slice(0, 10);

  const admin = createAdminSupabaseClient();

  // ── Fetch active students via enrollments ─────────────────────────────────
  const { data: enrollments, error: enrollErr } = await admin
    .from('enrollments')
    .select('student_id, users:student_id(id, school_id), class_id')
    .eq('is_active', true);

  if (enrollErr) {
    console.error('[weekly-snapshot] failed to fetch enrollments:', enrollErr);
    return NextResponse.json({ error: 'Failed to fetch students' }, { status: 500 });
  }

  // Deduplicate: a student may have multiple active enrollments
  const seen = new Set<string>();
  type StudentRow = { student_id: string; school_id: string; class_id: string };
  const students: StudentRow[] = [];
  for (const row of enrollments ?? []) {
    const sid = row.student_id as string;
    if (!seen.has(sid)) {
      seen.add(sid);
      const u = row.users as unknown as { id: string; school_id: string } | null;
      students.push({
        student_id: sid,
        school_id: u?.school_id ?? '',
        class_id: row.class_id as string,
      });
    }
  }

  // ── Per-student processing ─────────────────────────────────────────────────
  let processed = 0;
  let failed = 0;
  const skipped = 0;

  for (const { student_id, school_id } of students) {
    try {
      // ── Step 1: recomputeSkillStatesForStudent — MUST run first (C11) ──────
      // C11: object signature { studentId, schoolId }
      await recomputeSkillStatesForStudent(admin, {
        studentId: student_id,
        schoolId: school_id || null,
      });

      // ── Step 2: roll up strength/struggle from skill_learning_state ─────────
      // MUST run AFTER step 1 so the states are fresh.
      const { data: skillStates } = await admin
        .from('skill_learning_state')
        .select('skill:skill_id(name), state')
        .eq('student_id', student_id);

      const strength_topics: string[] = [];
      const struggle_topics: string[] = [];
      for (const row of (skillStates ?? []) as unknown as { skill: { name: string } | null; state: string }[]) {
        const name = row.skill?.name;
        if (!name) continue;
        if (row.state === 'ready_to_extend' || row.state === 'on_track') {
          strength_topics.push(name);
        } else if (row.state === 'needs_more_time' || row.state === 'needs_different_instruction') {
          struggle_topics.push(name);
        }
      }

      // ── Step 3: signal columns ─────────────────────────────────────────────

      // Quiz attempts — last 20, newest first
      // Select mastery_band + score_pct + submitted_at + is_complete + created_at
      // for both currentMasteryBand (C23) and consistency computations
      const { data: quizRows } = await admin
        .from('quiz_attempts')
        .select('score_pct, mastery_band, learning_style, submitted_at, is_complete, created_at')
        .eq('student_id', student_id)
        .order('submitted_at', { ascending: false })
        .limit(20);

      const quizAttempts = (quizRows ?? []) as QuizAttemptRow[];

      // C23: mastery_band = currentMasteryBand(quizRows) — quiz band, NOT computeSkillState
      const mastery_band = currentMasteryBand(
        quizAttempts.map((r) => ({
          mastery_band: r.mastery_band,
          submitted_at: r.submitted_at,
          created_at: r.created_at,
          is_complete: r.is_complete,
        })),
      );

      // learning_style: most recent non-null learning_style from quiz_attempts
      const learning_style_row = quizAttempts.find(
        (r) => (r as QuizAttemptRow & { learning_style?: string | null }).learning_style != null,
      );
      const learning_style =
        (learning_style_row as (QuizAttemptRow & { learning_style?: string | null }) | undefined)
          ?.learning_style ?? null;

      // Quiz score percentages for consistency + aggregates
      const quizScores = quizAttempts
        .map((r) => r.score_pct)
        .filter((s): s is number => s != null);

      const avg_score = quizScores.length
        ? Math.round((quizScores.reduce((a, b) => a + b, 0) / quizScores.length) * 10) / 10
        : null;

      const total_quizzes = quizAttempts.length;

      // C22: write both consistency_label AND consistency_score
      const last5 = quizScores.slice(0, 5);
      const consistencyResult = computeConsistency(last5);
      const consistency_label = consistencyResult.consistency_label;
      const consistency_score = consistencyResult.consistency_score;

      // Homework attempts — last 20, newest first
      const { data: hwRows } = await admin
        .from('homework_attempts')
        .select('score_pct, teli_hint_count, effort_label, submitted_at, allow_redo, is_redo')
        .eq('student_id', student_id)
        .order('submitted_at', { ascending: false })
        .limit(20);

      const hwAttempts = (hwRows ?? []) as HomeworkAttemptRow[];
      const total_homework = hwAttempts.length;

      // HW/Quiz divergence
      const divergenceResult = computeHwQuizDivergence({
        homeworkScores: hwAttempts.map((r) => r.score_pct),
        quizScores: quizAttempts.map((r) => r.score_pct),
      });

      // C3 + C12 + C24: roster risk index — raw attempt arrays, injected referenceDate
      // NO computeSessionRisk (per-attempt/live, not a snapshot column)
      const riskResult = computeRosterRiskIndex(
        {
          homeworkAttempts: hwAttempts.map((r) => ({
            score: r.score_pct,
            submitted_at: r.submitted_at,
            allow_redo: r.allow_redo ?? false,
            is_redo: r.is_redo ?? false,
          })),
          quizAttempts: quizAttempts.map((r) => ({
            score: r.score_pct,
            submitted_at: r.submitted_at,
          })),
          totalAssigned: total_homework, // best available: submitted = assigned for this student
        },
        refDate, // C24: canonical reference date, not bare new Date()
      );

      // dominant_effort_pattern: modal effort_label from last 5 homework attempts
      const effortLabels = hwAttempts
        .slice(0, 5)
        .map((r) => r.effort_label)
        .filter((l): l is string => l != null);
      let dominant_effort_pattern: string | null = null;
      if (effortLabels.length > 0) {
        const counts: Record<string, number> = {};
        for (const l of effortLabels) counts[l] = (counts[l] ?? 0) + 1;
        dominant_effort_pattern = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      }

      // recent_effort_labels: last 5 homework attempts as JSONB
      const recent_effort_labels = hwAttempts.slice(0, 5).map((r) => ({
        score: r.score_pct,
        hints: r.teli_hint_count,
        effort_label: r.effort_label,
        submitted_at: r.submitted_at,
      }));

      // avg_hints_per_attempt
      const hintValues = hwAttempts
        .map((r) => r.teli_hint_count)
        .filter((v): v is number => v != null);
      const avg_hints_per_attempt = hintValues.length
        ? Math.round((hintValues.reduce((a, b) => a + b, 0) / hintValues.length) * 100) / 100
        : null;

      // preferred_scaffold_level: derive from mastery_band (cheap heuristic)
      const preferred_scaffold_level =
        mastery_band === 'reteach'
          ? 'high'
          : mastery_band === 'grade_level'
            ? 'medium'
            : mastery_band === 'advanced'
              ? 'low'
              : null;

      // C15: improvement_4w — EXACT 28-day .eq lookup, null when absent (NOT .lte)
      const { data: priorSnap } = await admin
        .from('student_model_snapshots')
        .select('avg_score')
        .eq('snapshot_date', priorDateStr)
        .eq('student_id', student_id)
        .maybeSingle();
      const improvement_4w =
        priorSnap?.avg_score != null && avg_score != null
          ? Math.round((avg_score - Number(priorSnap.avg_score)) * 10) / 10
          : null;

      // ── Step 4: UPSERT student_model_snapshots ────────────────────────────
      // Write ONLY real 0006 + 0011 columns.
      // NO trajectory column (does not exist in schema).
      // NO session_risk column (does not exist in schema — C3).
      const { error: upsertErr } = await admin
        .from('student_model_snapshots')
        .upsert(
          {
            student_id,
            school_id: school_id || null,
            snapshot_date: snapshotDate,
            snapshot_schema_version: 'v2',
            // mastery (C23: from quiz band via currentMasteryBand)
            mastery_band,
            learning_style,
            // topic rollup (from fresh skill_learning_state — step 2)
            strength_topics,
            struggle_topics,
            // score aggregates
            avg_score,
            total_quizzes,
            total_homework,
            improvement_4w,
            // consistency (C22: both label + score)
            consistency_label,
            consistency_score,
            // risk (C3/C12/C24: roster only, no session risk)
            risk_score: riskResult.risk_score,
            // divergence
            divergence_score: divergenceResult.divergence_score,
            divergence_direction: divergenceResult.divergence_direction,
            // effort
            dominant_effort_pattern,
            recent_effort_labels,
            avg_hints_per_attempt,
            preferred_scaffold_level,
          },
          { onConflict: 'student_id,snapshot_date' },
        );

      if (upsertErr) {
        console.error(`[weekly-snapshot] upsert failed for student ${student_id}:`, upsertErr);
        failed++;
        continue;
      }

      processed++;
    } catch (err) {
      // Per-student failures are ISOLATED — never abort the full job.
      console.error(`[weekly-snapshot] error for student ${student_id}:`, err);
      failed++;
    }
  }

  return NextResponse.json({
    snapshot_date: snapshotDate,
    processed,
    failed,
    skipped,
  });
}

// GET retained for Vercel cron probe (some environments send GET).
export async function GET(req: NextRequest): Promise<NextResponse> {
  return POST(req);
}
