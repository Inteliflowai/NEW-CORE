// src/lib/gradebook/loadGradebook.ts
// Pure gradebook loader — NO auth (caller guards via guardClassAccess). Mirrors loadRosterSignals.
// 5 batched queries, no N+1. See spec 2026-06-22-teacher-gradebook-design.md §4.
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeEffortLabel, type EffortLabel } from '@/lib/signals/computeEffortLabel';

export interface GradebookStudent { student_id: string; name: string; }
export interface GradebookAssignmentCol { assignment_key: string; title: string; due_at: string | null; }
export type CellStatus = 'graded' | 'submitted' | 'not_due' | 'missing' | 'redo' | 'redo_in_progress' | 'none';
export interface GradebookCell {
  attempt_id: string | null; status: CellStatus; displayed_grade: number | null;
  // The immutable AI grade — carried regardless of override so the drill-in's
  // "AI grade vs Your grade" comparison stays meaningful on overridden cells.
  score_pct: number | null;
  // Coach-posture effort phrase source (graded cells only). From the graded attempt's
  // stored effort_label when present, else recomputed from {displayed grade, teli hints};
  // null on every non-graded cell. Drives the drill-in's effort line.
  effort_label: EffortLabel | null;
  // The graded/turned-in attempt's teacher note (null when none), so the drill-in can
  // seed, edit AND clear it without a second fetch. null on no-attempt cells.
  teacher_notes: string | null;
  // The attempt's submission timestamp (null when not yet turned in), surfaced in the
  // drill-in header alongside the late/on-time badge. null on no-attempt cells.
  submitted_at: string | null;
  is_override: boolean; submitted_on_time: boolean | null; allow_redo: boolean;
}
export interface GradebookQuizCol { quiz_id: string; label: string; }
export interface GradebookQuizCell {
  quiz_attempt_id: string | null; is_complete: boolean; score_pct: number | null;
  mastery_band: 'reteach' | 'grade_level' | 'advanced' | null;
}
export interface Gradebook {
  class_id: string;
  students: GradebookStudent[];
  assignments: GradebookAssignmentCol[];
  cells: Record<string, Record<string, GradebookCell>>;
  class_average: number | null;
  column_averages: Record<string, number | null>;
  missing_count: number;
  quizzes: GradebookQuizCol[];
  quiz_cells: Record<string, Record<string, GradebookQuizCell>>;
}

const NONE = ['__none__'];
const MAX_ASSIGNMENT_COLS = 12;
const MAX_QUIZ_COLS = 8;

type AsgRow = { id: string; lesson_id: string | null; due_at: string | null; created_at: string | null; student_id: string };
type HwRow = { id: string; assignment_id: string; student_id: string; status: string; score_pct: number | null; teacher_score: number | null; effort_label: EffortLabel | null; teli_hint_count: number | null; teacher_notes: string | null; allow_redo: boolean | null; is_redo: boolean | null; attempt_no: number | null; submitted_on_time: boolean | null; submitted_at: string | null; graded_at: string | null };
type QzRow = { id: string; title: string | null; created_at: string | null };
type QaRow = { id: string; quiz_id: string; student_id: string; score_pct: number | null; mastery_band: GradebookQuizCell['mastery_band']; is_complete: boolean | null; submitted_at: string | null };

function colKey(a: AsgRow): string {
  if (a.lesson_id) return `lesson:${a.lesson_id}`;
  if (a.due_at) return `due:${a.due_at}`;
  return `id:${a.id}`;
}
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function dueLabel(due_at: string | null, ordinal: number): string {
  if (!due_at) return `Assignment ${ordinal}`;
  const d = new Date(due_at);
  return `Due ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
function latest<T extends { attempt_no?: number | null; submitted_at?: string | null; graded_at?: string | null; created_at?: string | null }>(rows: T[]): T | null {
  if (!rows.length) return null;
  return [...rows].sort((x, y) =>
    (y.attempt_no ?? 0) - (x.attempt_no ?? 0)
    || String(y.graded_at ?? y.submitted_at ?? '').localeCompare(String(x.graded_at ?? x.submitted_at ?? '')))[0];
}

export async function loadGradebook(admin: SupabaseClient, args: { classId: string; teacherId: string; now?: Date }): Promise<Gradebook> {
  const { classId } = args;
  // Clock is an explicit arg (default = real now) — no globalThis seam. Tests inject a fixed date.
  const now = args.now ?? new Date();

  // 1. Roster (rows).
  const { data: enr } = await admin.from('enrollments')
    .select('student_id, users:student_id(id, full_name, display_name)')
    .eq('class_id', classId).eq('is_active', true);
  const students: GradebookStudent[] = ((enr ?? []) as Array<{ student_id: string; users: { full_name?: string; display_name?: string } | null }>)
    .map(e => ({ student_id: e.student_id, name: (e.users?.display_name || e.users?.full_name || 'Student') }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const studentIds = students.map(s => s.student_id);

  // 2. Assignment columns (collapse per-student fan-out).
  const { data: asgData } = await admin.from('assignments')
    .select('id, lesson_id, due_at, created_at, student_id')
    .eq('class_id', classId).order('created_at', { ascending: false });
  const asgRows = (asgData ?? []) as AsgRow[];
  const groups = new Map<string, AsgRow[]>();
  for (const a of asgRows) { const k = colKey(a); (groups.get(k) ?? groups.set(k, []).get(k)!).push(a); }
  const colMeta = [...groups.entries()]
    .map(([key, rows]) => ({
      key, rows,
      maxCreated: rows.map(r => r.created_at ?? '').sort().at(-1) ?? '',
      // Deterministic column due_at: max non-null across the group (else null), so the
      // missing/not_due derivation is stable regardless of DB row order (M1).
      due_at: rows.map(r => r.due_at).filter((d): d is string => d != null).sort().at(-1) ?? null,
    }))
    .sort((a, b) => b.maxCreated.localeCompare(a.maxCreated))
    .slice(0, MAX_ASSIGNMENT_COLS);
  const assignments: GradebookAssignmentCol[] = colMeta.map((c, i) => ({ assignment_key: c.key, title: dueLabel(c.due_at, i + 1), due_at: c.due_at }));
  // assignment_id → column key (for cell mapping).
  const idToKey = new Map<string, string>();
  for (const c of colMeta) for (const r of c.rows) idToKey.set(r.id, c.key);
  const assignmentIds = [...idToKey.keys()];

  // 3. Attempts (cells).
  const { data: hwData } = await admin.from('homework_attempts')
    .select('id, assignment_id, student_id, status, score_pct, teacher_score, effort_label, teli_hint_count, teacher_notes, allow_redo, is_redo, attempt_no, submitted_on_time, submitted_at, graded_at')
    .in('assignment_id', assignmentIds.length ? assignmentIds : NONE)
    .in('student_id', studentIds.length ? studentIds : NONE);
  const hwRows = (hwData ?? []) as HwRow[];
  // group by (student, colKey)
  const byCell = new Map<string, HwRow[]>();
  for (const h of hwRows) {
    const k = idToKey.get(h.assignment_id); if (!k) continue;
    const id = `${h.student_id}__${k}`; (byCell.get(id) ?? byCell.set(id, []).get(id)!).push(h);
  }
  const dueByKey = new Map(colMeta.map(c => [c.key, c.due_at]));
  // Per-(student,colKey) assignment-row membership. A logical column may not include
  // every enrolled student (differentiated assignments, mid-term enrollment). A student
  // with NO assignment row in a column was never assigned that work → cell is `none`
  // (inert: not a real "miss", excluded from missing_count). Built from colMeta rows in hand.
  const assignedByCell = new Set<string>();
  for (const c of colMeta) for (const r of c.rows) assignedByCell.add(`${r.student_id}__${c.key}`);
  const cells: Gradebook['cells'] = {};
  let missing_count = 0;
  for (const s of students) {
    cells[s.student_id] = {};
    for (const col of assignments) {
      const attempts = byCell.get(`${s.student_id}__${col.assignment_key}`) ?? [];
      const due = dueByKey.get(col.assignment_key) ?? null;
      const past = due ? new Date(due).getTime() < now.getTime() : false;
      const graded = latest(attempts.filter(a => a.status === 'graded'));
      const newest = latest(attempts);
      let status: CellStatus; let displayed_grade: number | null = null; let score_pct: number | null = null; let is_override = false;
      let allow_redo = false; let submitted_on_time: boolean | null = null; let attempt_id: string | null = null;
      let effort_label: EffortLabel | null = null;
      // Drill-in read fields (A-C6/A-U5/A-C7): the teacher note + submission date, sourced from
      // the attempt that drives the cell (the graded one when present, else the turned-in newest).
      let teacher_notes: string | null = null; let submitted_at: string | null = null;
      if (graded) {
        score_pct = graded.score_pct ?? null; // immutable AI grade, carried regardless of override
        displayed_grade = (typeof graded.teacher_score === 'number') ? graded.teacher_score : score_pct;
        is_override = graded.teacher_score != null; allow_redo = !!graded.allow_redo;
        submitted_on_time = graded.submitted_on_time ?? null; attempt_id = graded.id;
        teacher_notes = graded.teacher_notes ?? null; submitted_at = graded.submitted_at ?? null;
        // Effort phrase source: stored label when present, else recompute against the
        // DISPLAYED grade (override-wins) + this attempt's Teli hint count (I4).
        effort_label = graded.effort_label
          ?? computeEffortLabel({ score: displayed_grade, teliHintCount: graded.teli_hint_count ?? 0 });
      }
      // A non-graded attempt is "turned in" ONLY for the explicit submit-pipeline statuses.
      // A lone `in_progress` (inserted the moment a student OPENS the work) must NOT read as
      // submitted (I2): past-due → real miss, otherwise → not_due.
      const TURNED_IN = newest != null && ['submitted', 'grading', 'pending_grade'].includes(newest.status);
      if (!attempts.length) {
        if (!assignedByCell.has(`${s.student_id}__${col.assignment_key}`)) {
          status = 'none'; // never assigned to this student → inert, not a miss
        } else {
          status = past ? 'missing' : 'not_due';
          if (status === 'missing') missing_count++;
        }
      } else if (graded && newest && newest.status !== 'graded' && (newest.attempt_no ?? 1) > 1) {
        status = 'redo_in_progress';
      } else if (graded && graded.allow_redo) {
        status = 'redo';
      } else if (newest?.status === 'graded') {
        status = 'graded';
      } else if (TURNED_IN) {
        status = 'submitted'; attempt_id = newest?.id ?? null;
        // A turned-in-but-ungraded cell still carries its note + submission date for the drill-in.
        teacher_notes = newest?.teacher_notes ?? null; submitted_at = newest?.submitted_at ?? null;
      } else {
        // A lone non-graded, not-turned-in attempt (e.g. opened-but-abandoned in_progress).
        status = past ? 'missing' : 'not_due';
        if (status === 'missing') missing_count++;
      }
      cells[s.student_id][col.assignment_key] = { attempt_id, status, displayed_grade, score_pct, effort_label, teacher_notes, submitted_at, is_override, submitted_on_time, allow_redo };
    }
  }

  // 4. Footers.
  const column_averages: Gradebook['column_averages'] = {};
  const all: number[] = [];
  for (const col of assignments) {
    const vals: number[] = [];
    for (const s of students) {
      const c = cells[s.student_id][col.assignment_key];
      if (c.displayed_grade != null && (c.status === 'graded' || c.status === 'redo' || c.status === 'redo_in_progress')) vals.push(c.displayed_grade);
    }
    column_averages[col.assignment_key] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    all.push(...vals);
  }
  const class_average = all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : null;

  // 5. Quizzes (diagnostic — keyed by quiz_id). Most-recent first (M5: created_at desc).
  const { data: qzData } = await admin.from('quizzes')
    .select('id, title, created_at')
    .eq('class_id', classId)
    .order('created_at', { ascending: false });
  const qzRows = (qzData ?? []) as QzRow[];
  const quizIds = qzRows.map(q => q.id);
  const { data: qaData } = await admin.from('quiz_attempts')
    .select('id, quiz_id, student_id, score_pct, mastery_band, is_complete, submitted_at')
    .in('quiz_id', quizIds.length ? quizIds : NONE)
    .in('student_id', studentIds.length ? studentIds : NONE);
  const qaRows = (qaData ?? []) as QaRow[];
  const quiz_cells: Gradebook['quiz_cells'] = {};
  for (const s of students) quiz_cells[s.student_id] = {};
  // The MEANINGFUL latest attempt per (student, quiz): prefer is_complete=true, then most-recent
  // submitted_at. Decided in JS so it does not depend on Postgres NULLS-FIRST ordering — a newer
  // in-progress retake (null submitted_at) must NOT mask the completed result (I3).
  const better = (a: QaRow, b: QaRow): QaRow => {
    if (!!a.is_complete !== !!b.is_complete) return a.is_complete ? a : b;
    return String(a.submitted_at ?? '').localeCompare(String(b.submitted_at ?? '')) >= 0 ? a : b;
  };
  const pick = new Map<string, QaRow>(); // `${student}__${quiz}` → best attempt
  const usedQuiz = new Set<string>();
  for (const qa of qaRows) {
    if (!quiz_cells[qa.student_id]) continue;
    usedQuiz.add(qa.quiz_id);
    const k = `${qa.student_id}__${qa.quiz_id}`;
    const cur = pick.get(k);
    pick.set(k, cur ? better(cur, qa) : qa);
  }
  // A-C3: decide the KEPT quiz columns FIRST (filter to quizzes-with-attempts, then slice), so
  // quiz_cells can be built ONLY for kept quizzes — the matrix can never carry orphaned cells for
  // columns sliced off past MAX_QUIZ_COLS.
  const quizzes: GradebookQuizCol[] = qzRows
    .filter(q => usedQuiz.has(q.id))
    .slice(0, MAX_QUIZ_COLS)
    .map(q => ({ quiz_id: q.id, label: q.title || 'Check' }));
  const keptQuizIds = new Set(quizzes.map(q => q.quiz_id));
  for (const qa of pick.values()) {
    if (!keptQuizIds.has(qa.quiz_id)) continue; // skip cells for sliced-off columns
    quiz_cells[qa.student_id][qa.quiz_id] = { quiz_attempt_id: qa.id, is_complete: !!qa.is_complete, score_pct: qa.score_pct ?? null, mastery_band: qa.mastery_band ?? null };
  }

  return { class_id: classId, students, assignments, cells, class_average, column_averages, missing_count, quizzes, quiz_cells };
}
