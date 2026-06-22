// src/app/api/attempts/homework-submit/route.ts
import { NextResponse, after } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { gradeAssignment } from '@/lib/engine/gradeAssignment';
import { computeEffortLabel } from '@/lib/signals/computeEffortLabel';
import { assignmentResultBundle } from '@/lib/assignments/assignmentResultBundle';
import { normalizeContent } from '@/lib/assignments/loadAssignmentForPlay';
import { computeMasteryBand } from '@/lib/utils/scoring';
import { gradeTextToTier } from '@/lib/quiz/gradeTextToTier';
import { respondEngineError } from '@/app/api/_lib/errorEnvelope';
import { recomputeSkillStatesForStudent } from '@/lib/skills/recomputeSkillStates';
import type { QuestionAttemptData, SessionAggregates, RawSessionData } from '@/lib/signals/behavioralTypes';

type ResponsesShape = { tasks: Record<string, { text: string; image_url: string | null }> };
type PerTaskMetric = { step: number; timeTakenMs: number; changeCount: number };
const PENDING = (id: string) => NextResponse.json({ attempt_id: id, grading_delayed: true, message: 'Your answers have been saved. Grading is on its way — check back shortly.' });

export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: { attempt_id?: string; responses?: ResponsesShape; sessionAggregates?: Partial<SessionAggregates>; perTaskMetrics?: PerTaskMetric[] };
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
    if (!body.attempt_id || !body.responses) return NextResponse.json({ error: 'Missing attempt_id or responses' }, { status: 400 });

    const admin = createAdminSupabaseClient();
    const { data: attemptRow } = await admin.from('homework_attempts')
      .select('id, student_id, assignment_id, status, teli_hint_count, created_at, allow_redo')
      .eq('id', body.attempt_id).eq('student_id', user.id).maybeSingle();
    const attempt = attemptRow as { id: string; student_id: string; assignment_id: string; status: string; teli_hint_count: number | null; created_at: string; allow_redo: boolean | null } | null;
    if (!attempt) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });

    // Load the one active (or most-recent, now-completed) Teli session for this attempt.
    // The partial-unique index in migration 0016 guarantees at most one ACTIVE session;
    // order+limit(1) picks the latest. No session → Teli was never used.
    const { data: tutorSession } = await admin.from('tutor_sessions')
      .select('id').eq('attempt_id', attempt.id).eq('student_id', user.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    const sessionId = (tutorSession as { id?: string } | null)?.id ?? null;

    // Source the Teli hint count from the help-request MESSAGE rows — the always-written truth.
    // tutor_sessions.hint_count is bumped by a best-effort RPC whose failure is non-fatal, so it
    // can silently undercount and would downgrade effort_label; the message rows never desync.
    // Per-task counts also feed the moat's per-question hintsUsed.
    const perTaskHints = new Map<number, number>();
    let teliHintCount = 0;
    if (sessionId) {
      const { data: helpRows } = await admin.from('tutor_messages')
        .select('task_step').eq('session_id', sessionId).eq('role', 'student').eq('is_help_request', true);
      const rows = (helpRows ?? []) as { task_step: number | null }[];
      teliHintCount = rows.length;
      for (const r of rows) {
        if (r.task_step != null) perTaskHints.set(r.task_step, (perTaskHints.get(r.task_step) ?? 0) + 1);
      }
    }
    // Never re-grade/overwrite a graded row. A teacher-granted redo opens a NEW in_progress
    // row (via loadAssignmentForPlay); the player submits THAT row, not this graded one — so
    // this guard blocks ANY graded attempt unconditionally (redo keeps history, never overwrites).
    if (attempt.status === 'graded') return NextResponse.json({ error: 'Already graded' }, { status: 409 });

    const { data: aRow } = await admin.from('assignments').select('id, content, due_at').eq('id', attempt.assignment_id).maybeSingle();
    // Normalize the live SEEDED task shape `{ type, prompt }` → `{ step, description }` so the
    // completeness gate, the grader, and the moat hook all key off a numeric `step`.
    const content = normalizeContent((aRow as { content?: import('@/lib/assignments/loadAssignmentForPlay').AssignmentContent } | null)?.content ?? null);
    const dueAt = (aRow as { due_at?: string | null } | null)?.due_at ?? null;
    const tasks = (content.tasks ?? []) as Array<{ step: number; description: string }>;
    if (tasks.length === 0) return NextResponse.json({ error: 'no_tasks' }, { status: 400 });

    // Completeness gate.
    const answers = body.responses.tasks ?? {};
    const missing = tasks.filter(t => { const a = answers[String(t.step)]; return !(a && (a.text?.trim() || a.image_url)); });
    if (missing.length > 0) return NextResponse.json({ error: 'incomplete_assignment', missing_count: missing.length, total_tasks: tasks.length }, { status: 400 });

    // Mark grading (best-effort) + persist final answers.
    await admin.from('homework_attempts').update({ status: 'grading', responses: body.responses }).eq('id', attempt.id).eq('student_id', user.id);

    // Dedicated continuous grader (never half-grade: throw → pending).
    let grade;
    try {
      grade = await gradeAssignment({ assignmentTitle: content.title ?? 'Assignment', tasks, responses: answers });
    } catch {
      await admin.from('homework_attempts').update({ status: 'pending_grade', review_required: true, submitted_at: new Date().toISOString() }).eq('id', attempt.id).eq('student_id', user.id);
      return PENDING(attempt.id);
    }

    const scorePct = Math.round(grade.overall_grade);
    const masteryBand = computeMasteryBand(scorePct);
    const effortLabel = computeEffortLabel({ score: scorePct, teliHintCount }); // existing object-signature fn
    const submittedAt = new Date();
    const hoursToSubmit = Math.round(((submittedAt.getTime() - new Date(attempt.created_at).getTime()) / 3_600_000) * 10) / 10;
    const onTime = dueAt ? submittedAt.getTime() <= new Date(dueAt).getTime() : true; // untimed: on-time unless past due_at

    const { error: writeErr } = await admin.from('homework_attempts').update({
      status: 'graded', score_pct: scorePct,
      ai_feedback: { overall: grade.overall_feedback, tasks: grade.task_grades },
      task_grades: grade.task_grades, effort_label: effortLabel,
      teli_hint_count: teliHintCount,
      submitted_at: submittedAt.toISOString(), graded_at: submittedAt.toISOString(),
      submitted_on_time: onTime, hours_to_submit: hoursToSubmit, review_required: false,
    }).eq('id', attempt.id).eq('student_id', user.id);
    if (writeErr) {
      await admin.from('homework_attempts').update({ status: 'pending_grade', review_required: true, submitted_at: submittedAt.toISOString() }).eq('id', attempt.id).eq('student_id', user.id);
      return PENDING(attempt.id);
    }

    // Close the Teli session for this (now-graded) attempt — honors the tutor_sessions
    // status lifecycle (CHECK + partial-unique index in migration 0016) that the schema
    // defines but had no writer, so Epic-3 staff reads can rely on a real completed state.
    if (sessionId) {
      await admin.from('tutor_sessions').update({ status: 'completed' }).eq('id', sessionId);
    }

    // (per-task hint counts + teliHintCount were sourced above from the help-message rows.)

    // ── Behavioral-signals hook (the MOAT) — context:'homework' ──
    after(async () => {
      try {
        const { computeSignals } = await import('@/lib/signals/computeSignals');
        const { upsertBehavioralSignals } = await import('@/lib/signals/behavioralModel');
        const { data: userRow } = await admin.from('users').select('school_id').eq('id', attempt.student_id).single();
        const schoolId = (userRow as { school_id?: string | null } | null)?.school_id ?? null;
        const gradeByStep = new Map(grade.task_grades.map(g => [g.step, g.grade]));
        const metrics = new Map((body.perTaskMetrics ?? []).map(m => [m.step, m]));
        const questionAttempts: QuestionAttemptData[] = tasks.map(t => ({
          questionId: String(t.step), questionIndex: t.step,
          isCorrect: (gradeByStep.get(t.step) ?? 0) >= 50,
          timeTakenMs: metrics.get(t.step)?.timeTakenMs ?? 0,
          changeCount: metrics.get(t.step)?.changeCount ?? 0,
          hintsUsed: perTaskHints.get(t.step) ?? 0,
        }));
        const sa = body.sessionAggregates ?? {};
        const aggregates: SessionAggregates = {
          focusLossCount: sa.focusLossCount ?? 0, pasteCount: sa.pasteCount ?? 0, pauseCount: sa.pauseCount ?? 0,
          totalPauseMs: sa.totalPauseMs ?? 0, totalFocusLossMs: sa.totalFocusLossMs ?? 0, backspaceCount: sa.backspaceCount ?? 0,
          keypressCount: sa.keypressCount ?? 0, ttsPlayCount: sa.ttsPlayCount ?? 0, canvasUsed: sa.canvasUsed ?? false, stuckEraseCount: sa.stuckEraseCount ?? 0,
        };
        const rawSession: RawSessionData = {
          studentId: attempt.student_id, sessionId: attempt.id, context: 'homework', schoolId,
          questionAttempts, aggregates,
          sessionStartMs: new Date(attempt.created_at).getTime(), sessionEndMs: submittedAt.getTime(),
        };
        await upsertBehavioralSignals(admin, { studentId: attempt.student_id, schoolId, next: computeSignals(rawSession) });
      } catch (err) { console.warn('[homework-submit] behavioral hook failed (non-fatal):', err); }
    });

    // ── Skill-state recompute hook ──
    after(async () => { try { await recomputeSkillStatesForStudent(admin, { studentId: attempt.student_id, schoolId: null }); } catch (err) { console.warn('[homework-submit] skill recompute failed (non-fatal):', err); } });

    // ── Student-safe result (assignments SHOW the grade) ──
    const { data: profile } = await admin.from('users').select('grade_level, full_name').eq('id', attempt.student_id).single();
    const tier = gradeTextToTier((profile as { grade_level?: string | null } | null)?.grade_level ?? null);
    const firstName = ((profile as { full_name?: string | null } | null)?.full_name ?? '').trim().split(/\s+/)[0] || null;
    const result = assignmentResultBundle({ scorePct, masteryBand, tier, firstName, attemptId: attempt.id, rawOverallFeedback: grade.overall_feedback, rawTaskFeedback: grade.task_grades.map(g => ({ step: g.step, feedback: g.feedback })) });

    return NextResponse.json({ attempt_id: attempt.id, result });
  } catch (err) {
    console.error('[homework-submit] error:', err);
    return respondEngineError(err);
  }
}
