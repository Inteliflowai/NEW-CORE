// src/lib/gradebook/loadGradebook.ts
// Pure gradebook loader — NO auth (caller guards via guardClassAccess). Mirrors loadRosterSignals.
// 5 batched queries, no N+1. See spec 2026-06-22-teacher-gradebook-design.md §4.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface GradebookStudent { student_id: string; name: string; }
export interface GradebookAssignmentCol { assignment_key: string; title: string; due_at: string | null; }
export type CellStatus = 'graded' | 'submitted' | 'not_due' | 'missing' | 'redo' | 'redo_in_progress' | 'none';
export interface GradebookCell {
  attempt_id: string | null; status: CellStatus; displayed_grade: number | null;
  // The immutable AI grade — carried regardless of override so the drill-in's
  // "AI grade vs Your grade" comparison stays meaningful on overridden cells.
  score_pct: number | null;
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

type AsgRow = { id: string; lesson_id: string | null; content: Record<string, unknown> | null; due_at: string | null; created_at: string | null; student_id: string };
type HwRow = { id: string; assignment_id: string; student_id: string; status: string; score_pct: number | null; teacher_score: number | null; allow_redo: boolean | null; is_redo: boolean | null; attempt_no: number | null; submitted_on_time: boolean | null; submitted_at: string | null; graded_at: string | null };
type QzRow = { id: string; title: string | null };
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

export async function loadGradebook(admin: SupabaseClient, args: { classId: string; teacherId: string }): Promise<Gradebook> {
  const { classId } = args;

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
    .select('id, lesson_id, content, due_at, created_at, student_id')
    .eq('class_id', classId).order('created_at', { ascending: false });
  const asgRows = (asgData ?? []) as AsgRow[];
  const groups = new Map<string, AsgRow[]>();
  for (const a of asgRows) { const k = colKey(a); (groups.get(k) ?? groups.set(k, []).get(k)!).push(a); }
  const colMeta = [...groups.entries()]
    .map(([key, rows]) => ({ key, rows, maxCreated: rows.map(r => r.created_at ?? '').sort().at(-1) ?? '', due_at: rows[0].due_at }))
    .sort((a, b) => b.maxCreated.localeCompare(a.maxCreated))
    .slice(0, MAX_ASSIGNMENT_COLS);
  const assignments: GradebookAssignmentCol[] = colMeta.map((c, i) => ({ assignment_key: c.key, title: dueLabel(c.due_at, i + 1), due_at: c.due_at }));
  // assignment_id → column key (for cell mapping).
  const idToKey = new Map<string, string>();
  for (const c of colMeta) for (const r of c.rows) idToKey.set(r.id, c.key);
  const assignmentIds = [...idToKey.keys()];

  // 3. Attempts (cells).
  const { data: hwData } = await admin.from('homework_attempts')
    .select('id, assignment_id, student_id, status, score_pct, teacher_score, effort_label, teli_hint_count, allow_redo, is_redo, attempt_no, submitted_on_time, submitted_at, graded_at, task_grades, teacher_notes, review_required')
    .in('assignment_id', assignmentIds.length ? assignmentIds : NONE)
    .in('student_id', studentIds.length ? studentIds : NONE);
  const hwRows = (hwData ?? []) as HwRow[];
  // group by (student, colKey)
  const byCell = new Map<string, HwRow[]>();
  for (const h of hwRows) {
    const k = idToKey.get(h.assignment_id); if (!k) continue;
    const id = `${h.student_id}__${k}`; (byCell.get(id) ?? byCell.set(id, []).get(id)!).push(h);
  }
  const now = args && (globalThis as { __NOW__?: number }).__NOW__ ? new Date((globalThis as { __NOW__?: number }).__NOW__!) : new Date();
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
      if (graded) {
        score_pct = graded.score_pct ?? null; // immutable AI grade, carried regardless of override
        displayed_grade = (typeof graded.teacher_score === 'number') ? graded.teacher_score : score_pct;
        is_override = graded.teacher_score != null; allow_redo = !!graded.allow_redo;
        submitted_on_time = graded.submitted_on_time ?? null; attempt_id = graded.id;
      }
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
      } else {
        status = 'submitted'; attempt_id = newest?.id ?? null;
      }
      cells[s.student_id][col.assignment_key] = { attempt_id, status, displayed_grade, score_pct, is_override, submitted_on_time, allow_redo };
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

  // 5. Quizzes (diagnostic — keyed by quiz_id).
  const { data: qzData } = await admin.from('quizzes').select('id, title').eq('class_id', classId);
  const qzRows = (qzData ?? []) as QzRow[];
  const quizIds = qzRows.map(q => q.id);
  const { data: qaData } = await admin.from('quiz_attempts')
    .select('id, quiz_id, student_id, score_pct, mastery_band, is_complete, submitted_at')
    .in('quiz_id', quizIds.length ? quizIds : NONE)
    .in('student_id', studentIds.length ? studentIds : NONE)
    .order('submitted_at', { ascending: false });
  const qaRows = (qaData ?? []) as QaRow[];
  const usedQuiz = new Set<string>();
  const quiz_cells: Gradebook['quiz_cells'] = {};
  for (const s of students) quiz_cells[s.student_id] = {};
  for (const qa of qaRows) { // first seen per (student, quiz) is latest (ordered desc)
    if (!quiz_cells[qa.student_id]) continue;
    if (quiz_cells[qa.student_id][qa.quiz_id]) continue;
    quiz_cells[qa.student_id][qa.quiz_id] = { quiz_attempt_id: qa.id, is_complete: !!qa.is_complete, score_pct: qa.score_pct ?? null, mastery_band: qa.mastery_band ?? null };
    usedQuiz.add(qa.quiz_id);
  }
  const quizzes: GradebookQuizCol[] = qzRows
    .filter(q => usedQuiz.has(q.id))
    .slice(0, MAX_QUIZ_COLS)
    .map(q => ({ quiz_id: q.id, label: q.title || 'Check' }));

  return { class_id: classId, students, assignments, cells, class_average, column_averages, missing_count, quizzes, quiz_cells };
}
