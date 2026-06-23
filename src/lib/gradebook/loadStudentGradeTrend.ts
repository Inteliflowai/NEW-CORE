// src/lib/gradebook/loadStudentGradeTrend.ts
// Pure per-student grade-over-time loader — NO auth (caller guards via the route's auth chain).
// Reads this class's graded homework_attempts for one student, oldest→newest by graded_at, into
// dated grade points (override-wins: teacher_score ?? score_pct). Earned grades only — no band,
// no risk. Powers the GradeTrendSparkline in the drill-in and the student profile page.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface GradeTrendPoint { date: string; grade: number; assignment_title: string; on_time: boolean | null; }
export interface StudentGradeTrend {
  points: GradeTrendPoint[];
  direction: 'climbing' | 'steady' | 'sliding' | null;
  latest: number | null;
  average: number | null;
}

const NONE = ['__none__'];
const DIRECTION_THRESHOLD = 3; // pts of head→tail mean shift before we call it climbing/sliding

type AsgRow = { id: string; lesson_id: string | null };
type HwRow = { assignment_id: string; score_pct: number | null; teacher_score: number | null; graded_at: string | null; submitted_on_time: boolean | null };

function classifyDirection(grades: number[]): StudentGradeTrend['direction'] {
  if (grades.length < 3) return null;
  const third = Math.max(1, Math.floor(grades.length / 3));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const delta = mean(grades.slice(-third)) - mean(grades.slice(0, third));
  if (delta > DIRECTION_THRESHOLD) return 'climbing';
  if (delta < -DIRECTION_THRESHOLD) return 'sliding';
  return 'steady';
}

export async function loadStudentGradeTrend(
  admin: SupabaseClient,
  args: { studentId: string; classId: string },
): Promise<StudentGradeTrend> {
  const { studentId, classId } = args;

  // 1. This student's assignments in this class → ids + lesson_id.
  const { data: asgData } = await admin.from('assignments')
    .select('id, lesson_id')
    .eq('class_id', classId).eq('student_id', studentId);
  const asgRows = (asgData ?? []) as AsgRow[];
  const lessonByAsg = new Map(asgRows.map(a => [a.id, a.lesson_id] as const));
  const assignmentIds = asgRows.map(a => a.id);

  // 2. Lesson titles (for point labels).
  const lessonIds = [...new Set(asgRows.map(a => a.lesson_id).filter((x): x is string => x != null))];
  const { data: lessonData } = await admin.from('lessons')
    .select('id, title')
    .in('id', lessonIds.length ? lessonIds : NONE);
  const lessonTitle = new Map<string, string>(
    ((lessonData ?? []) as Array<{ id: string; title: string | null }>).map(l => [l.id, l.title ?? 'Assignment'] as const));

  // 3. Graded attempts, oldest→newest.
  const { data: hwData } = await admin.from('homework_attempts')
    .select('assignment_id, score_pct, teacher_score, graded_at, submitted_on_time, status')
    .in('assignment_id', assignmentIds.length ? assignmentIds : NONE)
    .eq('student_id', studentId)
    .eq('status', 'graded')
    .order('graded_at', { ascending: true });
  const hwRows = (hwData ?? []) as HwRow[];

  const points: GradeTrendPoint[] = [];
  for (const h of hwRows) {
    const grade = (typeof h.teacher_score === 'number') ? h.teacher_score : h.score_pct;
    if (grade == null || !h.graded_at) continue;
    const lid = lessonByAsg.get(h.assignment_id) ?? null;
    points.push({
      date: h.graded_at,
      grade,
      assignment_title: (lid && lessonTitle.get(lid)) || 'Assignment',
      on_time: h.submitted_on_time ?? null,
    });
  }

  const grades = points.map(p => p.grade);
  return {
    points,
    direction: classifyDirection(grades),
    latest: grades.length ? grades[grades.length - 1] : null,
    average: grades.length ? Math.round(grades.reduce((a, b) => a + b, 0) / grades.length) : null,
  };
}
