import type { SupabaseClient } from '@supabase/supabase-js';
import type { SkillLearningState } from '@/lib/skills/clVerbs';
import { studentSkillLabel } from '@/lib/copy/studentSkillLabel';

export interface StudentGrowthSkill {
  skillName: string;
  label: string;
}

export interface StudentGrowthData {
  gradeDirection: 'climbing' | 'steady' | 'sliding' | null;
  trendPoints: { date: string; grade: number }[];
  skills: StudentGrowthSkill[];
  latestHighFiveText: string | null;
  totalHighFiveCount: number;
}

type SLSRow = {
  skill: { id: string; name: string } | { id: string; name: string }[] | null;
  state: string;
  confidence: number | null;
  observation_count: number;
};
type HwRow = { score_pct: number | null; teacher_score: number | null; graded_at: string | null };
type HFRow = { id: string; note_text: string; created_at: string };

function classifyDir(grades: number[]): StudentGrowthData['gradeDirection'] {
  if (grades.length < 3) return null;
  const third = Math.max(1, Math.floor(grades.length / 3));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const delta = mean(grades.slice(-third)) - mean(grades.slice(0, third));
  if (delta > 3) return 'climbing';
  if (delta < -3) return 'sliding';
  return 'steady';
}

export async function loadStudentGrowth(
  admin: SupabaseClient,
  studentId: string,
): Promise<StudentGrowthData> {
  // 1. Skill states (min 2 observations to avoid cold-start noise)
  const { data: sls } = await admin
    .from('skill_learning_state')
    .select('skill:skill_id(id, name), state, confidence, observation_count')
    .eq('student_id', studentId)
    .gte('observation_count', 2);

  const skillRows = (sls ?? []) as SLSRow[];
  const skills: StudentGrowthSkill[] = skillRows
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, 6)
    .flatMap((row) => {
      const label = studentSkillLabel(row.state as SkillLearningState);
      if (!label) return [];
      const skillObj = Array.isArray(row.skill) ? row.skill[0] : row.skill;
      return [{ skillName: skillObj?.name ?? 'Unknown', label }];
    });

  // 2. Grade trend — class-agnostic (all graded attempts for this student)
  const { data: hw } = await admin
    .from('homework_attempts')
    .select('score_pct, teacher_score, graded_at')
    .eq('student_id', studentId)
    .eq('status', 'graded')
    .order('graded_at', { ascending: true });

  const hwRows = (hw ?? []) as HwRow[];
  const trendPoints: { date: string; grade: number }[] = [];
  for (const r of hwRows) {
    const grade = typeof r.teacher_score === 'number' ? r.teacher_score : r.score_pct;
    if (grade == null || !r.graded_at) continue;
    trendPoints.push({ date: r.graded_at, grade });
  }

  const gradeDirection = classifyDir(trendPoints.map(p => p.grade));

  // 3. Latest High-Five + total count
  const { data: hfData, count } = await admin
    .from('high_fives')
    .select('id, note_text, created_at', { count: 'exact' })
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .limit(1);

  const latestHf = ((hfData ?? []) as HFRow[])[0] ?? null;

  return {
    gradeDirection,
    trendPoints,
    skills,
    latestHighFiveText: latestHf?.note_text ?? null,
    totalHighFiveCount: count ?? 0,
  };
}
