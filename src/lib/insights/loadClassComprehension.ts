// src/lib/insights/loadClassComprehension.ts
// Class-level Comprehension Level aggregator (the moat). Teacher-only; rolls up the LIVE
// skill_learning_state across a class's students, SCOPED to the class's own skills (so a
// student in two classes never cross-contaminates) IN JS AND THE QUERY, with student names per
// bucket for the expand, plus the over-time trend from skill_state_snapshots (migration 0025).
//
// NO auth — the caller (Insights page) runs guardClassAccess + admin client first.
// NEVER returns the raw state enum or the 0-100 confidence to the surface — only bucket counts
// and names. Soft-word/verb display happens at the render layer.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SkillLearningState } from '@/lib/skills/clVerbs';
import { clBucketOf, classComprehensionIndex, classTrendDirection } from '@/lib/insights/classComprehension';

export interface StudentRef { student_id: string; full_name: string; }

export interface SkillComprehension {
  skill_id: string;
  skill_name: string;
  reinforce: number;
  on_track: number;
  enrich: number;
  reinforce_students: StudentRef[];
  on_track_students: StudentRef[];
  enrich_students: StudentRef[];
}

export interface ClassComprehensionTrendPoint { date: string; index: number; }

export interface ClassComprehension {
  skills: SkillComprehension[]; // top skills needing attention (reinforce>0), most-reinforce-first
  trend: { points: ClassComprehensionTrendPoint[]; direction: 'climbing' | 'steady' | 'sliding' | null };
}

const NONE = ['__none__'];
const MAX_SKILLS = 3;  // name the few skills that need action — not a wall
const TREND_WEEKS = 8; // recent weeks to chart

const EMPTY: ClassComprehension = { skills: [], trend: { points: [], direction: null } };

export async function loadClassComprehension(
  admin: SupabaseClient,
  classId: string,
): Promise<ClassComprehension> {
  // 1. Active students (id + name).
  const { data: enr } = await admin
    .from('enrollments')
    .select('student_id, users:student_id(id, full_name)')
    .eq('class_id', classId)
    .eq('is_active', true);
  type EnrRow = {
    student_id: string;
    users: { id: string; full_name: string } | { id: string; full_name: string }[] | null;
  };
  const nameById = new Map<string, string>();
  const studentIds: string[] = [];
  for (const raw of (enr ?? []) as EnrRow[]) {
    const u = Array.isArray(raw.users) ? raw.users[0] : raw.users;
    studentIds.push(raw.student_id);
    nameById.set(raw.student_id, u?.full_name ?? 'Student');
  }
  if (studentIds.length === 0) return EMPTY;

  // 2. Skills taught in THIS class = distinct quiz_questions.skill_id over the class's quizzes.
  const { data: quizRows } = await admin.from('quizzes').select('id').eq('class_id', classId);
  const quizIds = ((quizRows ?? []) as { id: string }[]).map((q) => q.id);
  const { data: qqRows } = await admin
    .from('quiz_questions').select('skill_id')
    .in('quiz_id', quizIds.length ? quizIds : NONE);
  const classSkillIds = [
    ...new Set(
      ((qqRows ?? []) as { skill_id: string | null }[])
        .map((r) => r.skill_id)
        .filter((x): x is string => x != null),
    ),
  ];
  if (classSkillIds.length === 0) return EMPTY;
  const classSkillIdSet = new Set(classSkillIds); // JS-level scoping guard (belt + suspenders)

  // 3. Live per-(student, skill) CL for these students × class skills (+ skill name).
  const { data: slsRows } = await admin
    .from('skill_learning_state')
    .select('student_id, state, skill:skill_id(id, name)')
    .in('student_id', studentIds)
    .in('skill_id', classSkillIds);
  type SlsRow = {
    student_id: string;
    state: string;
    skill: { id: string; name: string } | { id: string; name: string }[] | null;
  };
  const bySkill = new Map<string, { name: string; rows: { student_id: string; state: SkillLearningState }[] }>();
  for (const raw of (slsRows ?? []) as SlsRow[]) {
    const sk = Array.isArray(raw.skill) ? raw.skill[0] : raw.skill;
    if (!sk?.id || !classSkillIdSet.has(sk.id)) continue; // scope: never let another class's skill in
    let entry = bySkill.get(sk.id);
    if (!entry) { entry = { name: sk.name, rows: [] }; bySkill.set(sk.id, entry); }
    entry.rows.push({ student_id: raw.student_id, state: raw.state as SkillLearningState });
  }

  const allSkills: SkillComprehension[] = [];
  for (const [skill_id, { name, rows }] of bySkill) {
    const sc: SkillComprehension = {
      skill_id, skill_name: name,
      reinforce: 0, on_track: 0, enrich: 0,
      reinforce_students: [], on_track_students: [], enrich_students: [],
    };
    for (const r of rows) {
      const ref: StudentRef = { student_id: r.student_id, full_name: nameById.get(r.student_id) ?? 'Student' };
      const b = clBucketOf(r.state);
      if (b === 'reinforce') { sc.reinforce++; sc.reinforce_students.push(ref); }
      else if (b === 'on_track') { sc.on_track++; sc.on_track_students.push(ref); }
      else if (b === 'enrich') { sc.enrich++; sc.enrich_students.push(ref); }
      // null bucket: not-yet-assessed on this skill → not counted
    }
    allSkills.push(sc);
  }
  const skills = allSkills
    .filter((s) => s.reinforce > 0) // quiet: only surface skills that need action
    .sort((a, b) => b.reinforce - a.reinforce || (b.on_track + b.enrich) - (a.on_track + a.enrich))
    .slice(0, MAX_SKILLS);

  // 4. Over-time trend from skill_state_snapshots (per-week class comprehension index).
  //    Select skill_id so the same JS scoping guard applies to history too.
  const { data: snapRows } = await admin
    .from('skill_state_snapshots')
    .select('snapshot_date, state, skill_id')
    .in('student_id', studentIds)
    .in('skill_id', classSkillIds)
    .order('snapshot_date', { ascending: true });
  type SnapRow = { snapshot_date: string; state: string; skill_id: string };
  const statesByWeek = new Map<string, SkillLearningState[]>();
  for (const raw of (snapRows ?? []) as SnapRow[]) {
    if (!classSkillIdSet.has(raw.skill_id)) continue; // scope guard for history
    const list = statesByWeek.get(raw.snapshot_date) ?? [];
    list.push(raw.state as SkillLearningState);
    statesByWeek.set(raw.snapshot_date, list);
  }
  const recentWeeks = [...statesByWeek.keys()].sort().slice(-TREND_WEEKS);
  const points: ClassComprehensionTrendPoint[] = [];
  for (const wd of recentWeeks) {
    const idx = classComprehensionIndex(statesByWeek.get(wd) ?? []);
    if (idx != null) points.push({ date: wd, index: idx }); // weeks with no assessed states are dropped
  }
  return { skills, trend: { points, direction: classTrendDirection(points.map((p) => p.index)) } };
}
