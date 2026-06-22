import type { SupabaseClient } from '@supabase/supabase-js';
import type { AlertSourceKind, AlertSeverity } from '@/lib/copy/alertTriggerLabel';

const LOW = 60;        // < 60 => attention
const URGENT = 40;     // < 40 => urgent
const STRONG = 85;     // >= 85 => strong-result heads-up

export interface QuizAttemptRow { id: string; student_id: string; is_complete: boolean; score_pct: number | null; submitted_at: string | null }
export interface HwAttemptRow { id: string; student_id: string; assignment_id: string; status: string; score_pct: number | null; teacher_score: number | null; allow_redo: boolean; is_redo: boolean; submitted_at: string | null }
export interface ReconcileInput { students: { id: string; full_name: string }[]; quizAttempts: QuizAttemptRow[]; hwAttempts: HwAttemptRow[] }
export interface Condition { student_id: string; source_kind: AlertSourceKind; source_ref: string; severity: AlertSeverity }
export interface AlertView { id: string; student_id: string; student_name: string; source_kind: AlertSourceKind; severity: AlertSeverity; created_at: string }

function ts(s: string | null): number { return s ? new Date(s).getTime() : 0; }
function latest<T extends { submitted_at: string | null }>(rows: T[]): T | null {
  return rows.reduce<T | null>((best, r) => (best === null || ts(r.submitted_at) >= ts(best.submitted_at) ? r : best), null);
}

/** Pure: latest-attempt-wins condition set for the class. */
export function computeConditions(input: ReconcileInput, _now: Date): Condition[] {
  const out: Condition[] = [];
  for (const student of input.students) {
    const sid = student.id;

    // ── Quizzes: latest complete attempt ──
    const quizzes = input.quizAttempts.filter((q) => q.student_id === sid && q.is_complete);
    const latestQuiz = latest(quizzes);
    let quizIsLow = false;
    if (latestQuiz && latestQuiz.score_pct != null) {
      if (latestQuiz.score_pct < LOW) {
        quizIsLow = true;
        out.push({ student_id: sid, source_kind: 'low_quiz', source_ref: latestQuiz.id, severity: latestQuiz.score_pct < URGENT ? 'urgent' : 'watch' });
      }
    }

    // ── Assignments ──
    const hw = input.hwAttempts.filter((h) => h.student_id === sid);
    // low_assignment: latest non-redo graded/submitted attempt, displayed = teacher_score ?? score_pct
    const gradedish = hw.filter((h) => !h.is_redo && (h.status === 'graded' || h.status === 'submitted' || h.status === 'pending_grade'));
    const latestHw = latest(gradedish);
    let hwIsLow = false;
    if (latestHw) {
      const displayed = latestHw.teacher_score ?? latestHw.score_pct;
      if (displayed != null && displayed < LOW) {
        hwIsLow = true;
        out.push({ student_id: sid, source_kind: 'low_assignment', source_ref: latestHw.id, severity: displayed < URGENT ? 'urgent' : 'watch' });
      }
    }

    // reteach_flag: an attempt flagged allow_redo with no redo started for that assignment yet
    for (const h of hw) {
      if (h.allow_redo && !h.is_redo) {
        const redoExists = hw.some((r) => r.is_redo && r.assignment_id === h.assignment_id);
        if (!redoExists) out.push({ student_id: sid, source_kind: 'reteach_flag', source_ref: h.id, severity: 'watch' });
      }
    }

    // reteach_review: a submitted-but-not-graded redo
    for (const r of hw) {
      if (r.is_redo && (r.status === 'submitted' || r.status === 'pending_grade')) {
        out.push({ student_id: sid, source_kind: 'reteach_review', source_ref: r.id, severity: 'urgent' });
      }
    }

    // strong_result (info): latest quiz/assignment >= STRONG and not already low
    const strongQuiz = latestQuiz && !quizIsLow && latestQuiz.score_pct != null && latestQuiz.score_pct >= STRONG ? latestQuiz : null;
    const strongHwDisplayed = latestHw ? (latestHw.teacher_score ?? latestHw.score_pct) : null;
    const strongHw = latestHw && !hwIsLow && strongHwDisplayed != null && strongHwDisplayed >= STRONG ? latestHw : null;
    const strong = (strongQuiz && strongHw) ? (ts(strongQuiz.submitted_at) >= ts(strongHw.submitted_at) ? strongQuiz : strongHw) : (strongQuiz ?? strongHw);
    if (strong) out.push({ student_id: sid, source_kind: 'strong_result', source_ref: strong.id, severity: 'info' });
  }
  return out;
}

const SEV_ORDER: Record<AlertSeverity, number> = { urgent: 0, watch: 1, info: 2 };

/** Reconcile-on-read: compute conditions, upsert (DB-dedup), auto-clear stale, return the open set. Idempotent. */
export async function reconcileAlerts(
  admin: SupabaseClient,
  opts: { classId: string; now?: Date },
): Promise<AlertView[]> {
  const now = opts.now ?? new Date();
  const classId = opts.classId;

  // school_id for inserts
  const { data: cls } = await admin.from('classes').select('school_id').eq('id', classId).maybeSingle();
  const schoolId = (cls as { school_id?: string } | null)?.school_id;
  if (!schoolId) return [];

  // active enrolled students + names
  const { data: enr } = await admin.from('enrollments').select('student_id').eq('class_id', classId);
  const studentIds = (enr ?? []).map((e: { student_id: string }) => e.student_id);
  if (studentIds.length === 0) return [];
  const { data: userRows } = await admin.from('users').select('id, full_name').in('id', studentIds);
  const students = (userRows ?? []).map((u: { id: string; full_name: string | null }) => ({ id: u.id, full_name: u.full_name ?? 'Student' }));
  const nameById = new Map(students.map((s) => [s.id, s.full_name]));

  // class assignment + quiz ids
  const { data: asg } = await admin.from('assignments').select('id').eq('class_id', classId);
  const assignmentIds = (asg ?? []).map((a: { id: string }) => a.id);
  const { data: qz } = await admin.from('quizzes').select('id').eq('class_id', classId);
  const quizIds = (qz ?? []).map((q: { id: string }) => q.id);

  const { data: hwRows } = assignmentIds.length
    ? await admin.from('homework_attempts')
        .select('id, student_id, assignment_id, status, score_pct, teacher_score, allow_redo, is_redo, submitted_at')
        .in('assignment_id', assignmentIds).in('student_id', studentIds)
    : { data: [] as HwAttemptRow[] };
  const { data: quizRows } = quizIds.length
    ? await admin.from('quiz_attempts')
        .select('id, student_id, is_complete, score_pct, submitted_at')
        .in('quiz_id', quizIds).in('student_id', studentIds)
    : { data: [] as QuizAttemptRow[] };

  const conditions = computeConditions(
    { students, quizAttempts: (quizRows ?? []) as QuizAttemptRow[], hwAttempts: (hwRows ?? []) as HwAttemptRow[] },
    now,
  );

  // upsert open alerts (dedup on the occurrence unique index; do nothing on conflict)
  if (conditions.length) {
    await admin.from('alerts').upsert(
      conditions.map((c) => ({
        school_id: schoolId, class_id: classId, student_id: c.student_id,
        source_kind: c.source_kind, source_ref: c.source_ref, severity: c.severity,
        status: 'open', created_at: now.toISOString(),
      })),
      { onConflict: 'student_id,class_id,source_kind,source_ref', ignoreDuplicates: true },
    );
  }

  // load currently-open alerts, auto-clear those no longer in the condition set
  const { data: openRows } = await admin.from('alerts')
    .select('id, student_id, source_kind, source_ref, severity, created_at')
    .eq('class_id', classId).eq('status', 'open');
  const open = (openRows ?? []) as { id: string; student_id: string; source_kind: AlertSourceKind; source_ref: string; severity: AlertSeverity; created_at: string }[];
  const liveKeys = new Set(conditions.map((c) => `${c.student_id}|${c.source_kind}|${c.source_ref}`));
  const staleIds = open.filter((o) => !liveKeys.has(`${o.student_id}|${o.source_kind}|${o.source_ref}`)).map((o) => o.id);
  if (staleIds.length) {
    await admin.from('alerts').update({ status: 'resolved', resolved_at: now.toISOString(), resolved_by: null, resolution_note: 'cleared' }).in('id', staleIds);
  }

  // return the still-open set (those whose key is live), shaped + sorted
  return open
    .filter((o) => liveKeys.has(`${o.student_id}|${o.source_kind}|${o.source_ref}`))
    .map((o) => ({ id: o.id, student_id: o.student_id, student_name: nameById.get(o.student_id) ?? 'Student', source_kind: o.source_kind, severity: o.severity, created_at: o.created_at }))
    .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.student_name.localeCompare(b.student_name));
}
