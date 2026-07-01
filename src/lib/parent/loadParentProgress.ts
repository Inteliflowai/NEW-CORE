// src/lib/parent/loadParentProgress.ts
// Parent Progress page data. Reuses loadStudentGrowth (class-agnostic grade
// trend + skill labels) and adds upcoming assignments. Raw grades are
// normalized 0-1 SERVER-SIDE and never reach the client (mirrors the dashboard
// snapshot handling). Four-audience: no digits, no band/CL verbs.
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadStudentGrowth } from '@/lib/student/loadStudentGrowth';
import { formatDueLabel } from '@/lib/parent/dueLabel';
import type { TrendDirection } from '@/lib/copy/parentTrendCopy';

export interface ParentProgressPoint { date: string; grade: number; label: string }
export interface ParentProgressStrength { skillName: string; label: string }
export interface ParentProgressUpcoming { id: string; title: string; dueLabel: string }
export interface ParentProgressData {
  gradeDirection: TrendDirection;
  points: ParentProgressPoint[];
  strengths: ParentProgressStrength[];
  upcoming: ParentProgressUpcoming[];
}

const UPCOMING_LIMIT = 10;

/** Min-max normalize raw grades to 0-1; force digit-free label so the sparkline
 *  <title> fallback can never print a grade. Raw grades never leave the server. */
export function normalizeTrend(points: { date: string; grade: number }[]): ParentProgressPoint[] {
  if (points.length === 0) return [];
  const grades = points.map((p) => p.grade);
  const min = Math.min(...grades);
  const max = Math.max(...grades);
  const range = max - min || 1;
  return points.map((p) => ({ date: p.date, grade: (p.grade - min) / range, label: '' }));
}

/** Only the "doing well" skills, capped at 3, original order preserved. */
export function deriveStrengths(skills: { skillName: string; label: string }[]): ParentProgressStrength[] {
  return skills.filter((s) => s.label === 'Solid' || s.label === 'Excelling').slice(0, 3);
}

type UpcomingRow = {
  id: string;
  due_at: string | null;
  content: { title?: string } | null;
  lesson_id: string | null;
  lessons: { title: string | null } | { title: string | null }[] | null;
};

function lessonTitle(row: UpcomingRow): string | null {
  const l = row.lessons;
  if (!l) return null;
  const one = Array.isArray(l) ? l[0] : l;
  return one?.title ?? null;
}

export async function loadParentProgress(
  admin: SupabaseClient,
  studentId: string,
  now: Date = new Date(),
): Promise<ParentProgressData> {
  const growth = await loadStudentGrowth(admin, studentId);

  // One query: scalar columns (due_at, content) + the embedded lesson title.
  const { data: asgData } = await admin
    .from('assignments')
    .select('id, due_at, content, lesson_id, lessons:lesson_id(title)')
    .eq('student_id', studentId)
    .gt('due_at', now.toISOString())
    .order('due_at', { ascending: true })
    .limit(UPCOMING_LIMIT);
  const rows = (asgData ?? []) as UpcomingRow[];

  const upcoming: ParentProgressUpcoming[] = rows.map((r) => ({
    id: r.id,
    title: lessonTitle(r) || r.content?.title || 'Upcoming assignment',
    // `.gt('due_at', ...)` guarantees due_at is non-null here; `now` is a defensive fallback.
    dueLabel: formatDueLabel(r.due_at ?? now.toISOString(), now),
  }));

  return {
    gradeDirection: growth.gradeDirection,
    points: normalizeTrend(growth.trendPoints),
    strengths: deriveStrengths(growth.skills),
    upcoming,
  };
}
