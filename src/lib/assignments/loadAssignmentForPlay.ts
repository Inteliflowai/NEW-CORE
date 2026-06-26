// src/lib/assignments/loadAssignmentForPlay.ts
// Loads an assignment for the student player and resolves the attempt to work against:
//   • existence-hiding ownership guard (missing OR student mismatch → ownershipOk:false)
//   • SPARK assignments are blocked (handled by the SPARK launch path, not this player)
//   • resume an active attempt (in_progress, or a stranded 'grading' row after a crash)
//   • redo gate: a graded/submitted latest opens a NEW attempt ONLY when allow_redo on that row;
//     otherwise it returns that row with gradedLocked:true and creates nothing.
// All reads/writes go through the admin client (RLS is NOT the IDOR backstop — the caller
// has already established the authenticated studentId). Never writes class_id.
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasDiagnosticVocab } from '@/lib/copy/leakGuard';

export type AssignmentContent = { title?: string; instructions?: string; reading_passage?: string; audio_script?: string; tasks?: Array<{ step: number; description: string; type?: string; skill_name?: string }> };
export type ResponsesShape = { tasks: Record<string, { text: string; image_url: string | null }> };
export interface PlayableAssignment {
  assignment: { id: string; content: AssignmentContent };
  attempt: { id: string; status: string; responses: ResponsesShape; attempt_no: number };
  ownershipOk: boolean; sparkBlocked: boolean; gradedLocked: boolean;
}
const EMPTY: ResponsesShape = { tasks: {} };
const NO_ATTEMPT = { id: '', status: 'none', responses: EMPTY, attempt_no: 0 };

/**
 * Tolerate every persisted task shape so the grader never receives `undefined`. The live demo
 * writer (scripts/seedDemo.ts) persists tasks as `{ type, prompt }`; the rich AssignmentSchema
 * uses `{ step, description }`; lean shapes may carry only `description`. Every task gets a
 * numeric `step` and a non-empty `description` (prompt → description → instructions → '').
 */
export function normalizeContent(raw: AssignmentContent | null): AssignmentContent {
  const c = raw ?? {};
  const tasks = (c.tasks ?? []).map((t, i) => {
    const tt = t as { step?: number; description?: string; prompt?: string; type?: string; skill_name?: string };
    const name = typeof tt.skill_name === 'string' && tt.skill_name.trim() ? tt.skill_name.trim() : undefined;
    return {
      step: typeof tt.step === 'number' ? tt.step : i + 1,
      description: tt.description ?? tt.prompt ?? c.instructions ?? '',
      type: tt.type,
      // Topic name only; drop it if the LLM leaked a level/verb word into it (safe degrade → no heading).
      skill_name: name && !hasDiagnosticVocab(name) ? name : undefined,
    };
  });
  // Allow-list top-level fields — NEVER spread `c` (would leak content.mode / learning_style to the client).
  return { title: c.title, instructions: c.instructions, reading_passage: c.reading_passage, audio_script: c.audio_script, tasks };
}

export async function loadAssignmentForPlay(admin: SupabaseClient, studentId: string, assignmentId: string): Promise<PlayableAssignment> {
  const { data: row } = await admin.from('assignments').select('id, student_id, content, spark_status').eq('id', assignmentId).maybeSingle();
  if (!row || (row as { student_id: string }).student_id !== studentId) {
    return { assignment: { id: assignmentId, content: {} }, attempt: { ...NO_ATTEMPT }, ownershipOk: false, sparkBlocked: false, gradedLocked: false };
  }
  const r = row as { id: string; content: AssignmentContent | null; spark_status: string | null };
  const content = normalizeContent(r.content);
  if ((r.spark_status ?? 'none') !== 'none') {
    return { assignment: { id: r.id, content }, attempt: { ...NO_ATTEMPT }, ownershipOk: true, sparkBlocked: true, gradedLocked: false };
  }

  const { data: latest } = await admin.from('homework_attempts')
    .select('id, status, responses, attempt_no, allow_redo')
    .eq('assignment_id', assignmentId).eq('student_id', studentId)
    .order('attempt_no', { ascending: false }).limit(1).maybeSingle();
  const a = latest as { id: string; status: string; responses: ResponsesShape | null; attempt_no: number | null; allow_redo: boolean | null } | null;

  // Resume an active attempt (in_progress, or a stranded 'grading' row after a crash).
  if (a && (a.status === 'in_progress' || a.status === 'grading')) {
    return { assignment: { id: r.id, content }, attempt: { id: a.id, status: a.status, responses: a.responses ?? EMPTY, attempt_no: a.attempt_no ?? 1 }, ownershipOk: true, sparkBlocked: false, gradedLocked: false };
  }

  // Latest is graded/submitted: only a teacher-granted redo opens a NEW attempt.
  if (a && !a.allow_redo) {
    return { assignment: { id: r.id, content }, attempt: { id: a.id, status: a.status, responses: a.responses ?? EMPTY, attempt_no: a.attempt_no ?? 1 }, ownershipOk: true, sparkBlocked: false, gradedLocked: true };
  }

  const nextNo = (a?.attempt_no ?? 0) + 1;
  const { data: inserted } = await admin.from('homework_attempts')
    .insert({ assignment_id: assignmentId, student_id: studentId, status: 'in_progress', responses: EMPTY, attempt_no: nextNo, is_redo: nextNo > 1 })
    .select('id, status, responses, attempt_no').single();
  const ins = inserted as { id: string; status: string; responses: ResponsesShape | null; attempt_no: number };
  return { assignment: { id: r.id, content }, attempt: { id: ins.id, status: ins.status, responses: ins.responses ?? EMPTY, attempt_no: ins.attempt_no }, ownershipOk: true, sparkBlocked: false, gradedLocked: false };
}
