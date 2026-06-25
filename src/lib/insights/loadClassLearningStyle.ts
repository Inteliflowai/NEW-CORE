// src/lib/insights/loadClassLearningStyle.ts
// Class learning-style reassurance rollup (the moat). Teacher-only, NEVER per-student.
// Learning style is INFERRED from behavior and falls back to 'emerging' (the low-confidence
// sentinel) — so we exclude 'emerging'/null, and only speak when there's a real, confident mix.
// Copy says "differentiate", never "adapt" (Marvin, 2026-06-24). DRAFT → Barb.
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeLearningStyle } from '@/lib/utils/learningStyle';

export interface ClassLearningStyle { styles: string[]; line: string | null }

// Canonical (post-normalize) → friendly teacher-facing label.
const FRIENDLY: Record<string, string> = {
  visual: 'visual',
  auditory: 'auditory',
  text: 'reading-and-writing',
  kinesthetic: 'hands-on',
  social: 'discussion-based',
};
const DISPLAY_ORDER = ['visual', 'auditory', 'text', 'kinesthetic', 'social'];
const MIN_DISTINCT = 2; // need ≥2 confident styles to claim a "mix"
const MIN_STUDENTS = 3; // and ≥3 students with a confident style

/** Reassurance sentence from friendly labels (deterministic order). null below MIN_DISTINCT. */
export function learningStyleLine(friendly: string[]): string | null {
  if (friendly.length < MIN_DISTINCT) return null;
  const list =
    friendly.length === 2
      ? `${friendly[0]} and ${friendly[1]}`
      : `${friendly.slice(0, -1).join(', ')}, and ${friendly[friendly.length - 1]}`;
  return `Your class spans ${list} learners — assignments differentiate to each.`;
}

export async function loadClassLearningStyle(
  admin: SupabaseClient,
  classId: string,
): Promise<ClassLearningStyle> {
  const { data: enr } = await admin
    .from('enrollments').select('student_id').eq('class_id', classId).eq('is_active', true);
  const studentIds = ((enr ?? []) as { student_id: string }[]).map((r) => r.student_id);
  if (studentIds.length === 0) return { styles: [], line: null };

  const { data: qa } = await admin
    .from('quiz_attempts')
    .select('student_id, learning_style, submitted_at')
    .in('student_id', studentIds)
    .order('submitted_at', { ascending: false });
  type QaRow = { student_id: string; learning_style: string | null; submitted_at: string | null };

  // Most-recent NON-emerging style per student. Rows are newest-first, but Postgres returns
  // NULL submitted_at FIRST under DESC — so skip null-dated rows (they aren't reliably "recent").
  // A null/emerging row is skipped WITHOUT marking the student seen, so an older confident style
  // still wins.
  const styleByStudent = new Map<string, string>();
  for (const raw of (qa ?? []) as QaRow[]) {
    if (styleByStudent.has(raw.student_id)) continue;
    if (raw.submitted_at == null) continue; // null-dated → not a reliable "most recent"
    if (raw.learning_style == null) continue;
    const canon = normalizeLearningStyle(raw.learning_style);
    if (canon === 'emerging') continue; // low-confidence sentinel → excluded
    styleByStudent.set(raw.student_id, canon);
  }
  if (styleByStudent.size < MIN_STUDENTS) return { styles: [], line: null };

  const present = new Set([...styleByStudent.values()]);
  const friendly = DISPLAY_ORDER.filter((c) => present.has(c)).map((c) => FRIENDLY[c]);
  return { styles: friendly, line: learningStyleLine(friendly) };
}
