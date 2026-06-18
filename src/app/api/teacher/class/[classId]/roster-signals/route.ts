// src/app/api/teacher/class/[classId]/roster-signals/route.ts
// GET /api/teacher/class/[classId]/roster-signals
//
// Roster-level signal bundle for the teacher view (Plan 3 Task 16 read API).
//
// Auth flow:
//   1. auth.getUser() → 401 if not authenticated
//   2. C8 STAFF ROLE GATE: 403 unless teacher|school_admin|school_sysadmin|platform_admin
//      (guardClassAccess alone is class-scoped, not role-scoped — students/parents out)
//   3. guardClassAccess(classId) → 403 on IDOR
//
// Returns: per-student band+volatility+risk, diagnose-driven focus group (C4 shape),
//          class-wide concept gaps (detectConceptGaps).

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardClassAccess } from '@/lib/auth/guards';
import { currentMasteryBand, bandIsVolatile } from '@/lib/utils/scoring';
import { computeRosterRiskIndex } from '@/lib/signals/computeRosterRiskIndex';
import { diagnose } from '@/lib/signals/diagnosis';
import type { DiagnoseInput } from '@/lib/signals/diagnosis';
import { detectConceptGaps } from '@/lib/signals/conceptGapDetector';
import { computeHwQuizDivergence } from '@/lib/signals/computeHwQuizDivergence';

/** Staff roles that are allowed to see teacher-facing roster data. */
const STAFF_ROLES = new Set(['teacher', 'school_admin', 'school_sysadmin', 'platform_admin']);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ classId: string }> },
): Promise<NextResponse> {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 2. C8 STAFF ROLE GATE (BEFORE object guard) ────────────────────────────
  const { data: callerProfile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();
  const callerRole = callerProfile?.role ?? null;
  if (!callerRole || !STAFF_ROLES.has(callerRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { classId } = await params;

  // ── 3. Object-level IDOR guard ─────────────────────────────────────────────
  const guard = await guardClassAccess(classId);
  if (guard) return guard;

  const admin = createAdminSupabaseClient();

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

  // ── Per-student signals ─────────────────────────────────────────────────────
  const roster = await Promise.all(
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

      // C12: pass RAW attempt arrays to computeRosterRiskIndex
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

      // C4: DiagnoseInput shape = { divergence_score, hw_avg, quiz_avg, error_types }
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
        error_types: [], // caller would populate from misconception_observations if needed
      };

      const diagnosis = diagnose(diagnoseInput);

      return {
        student_id,
        full_name,
        band,
        volatile,
        risk,
        diagnosis,
      };
    }),
  );

  // ── Focus group (students where diagnosis is not null) ─────────────────────
  const focus_group = roster
    .filter((r) => r.diagnosis != null)
    .map((r) => ({
      student_id: r.student_id,
      full_name: r.full_name,
      diagnosis: r.diagnosis,
    }));

  // ── Class-wide concept gaps (detectConceptGaps from misconception_observations) ──
  const studentIds = students.map((s) => s.student_id);
  const { data: misconceptions } = await admin
    .from('misconception_observations')
    .select('student_id, skill_id, error_type')
    .in('student_id', studentIds.length > 0 ? studentIds : ['__none__']);

  // detectConceptGaps expects {questions, responses} for per-question analysis.
  // Using misconception_observations as the gap signal (skill-level, not question-level).
  // Build a question-indexed view from skill_id observations.
  const skillSet = new Set<string>();
  for (const m of (misconceptions ?? [])) {
    skillSet.add((m as { skill_id: string }).skill_id);
  }

  // Map skill_ids to question indices for the pure function
  const skillIndexMap: Record<string, number> = {};
  let idx = 0;
  for (const sid of skillSet) {
    skillIndexMap[sid] = idx++;
  }

  const concept_gaps = detectConceptGaps({
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
      isCorrect: false, // misconception = incorrect by definition
    })),
  });

  return NextResponse.json({
    class_id: classId,
    roster: roster.map((r) => ({
      student_id: r.student_id,
      full_name: r.full_name,
      band: r.band,
      volatile: r.volatile,
      risk: r.risk,
    })),
    focus_group,
    concept_gaps,
  });
}
