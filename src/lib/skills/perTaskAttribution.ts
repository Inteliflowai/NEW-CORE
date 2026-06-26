// src/lib/skills/perTaskAttribution.ts
// Pure helpers for CL → generation's "close the loop": attribute a graded assignment to
// its skills PER SKILL (one averaged observation each) so a per-skill assignment updates
// per-skill Comprehension Level precisely — WITHOUT inflating observation_count (still one
// observation per skill per assignment, matching the legacy assignment-level behavior).
import type { SkillHomeworkObservation } from './computeSkillState';

type Content = { tasks?: Array<{ step?: number; skill_id?: string | null }> } | null | undefined;

/** Pull (step, skill_id) for every task that carries a non-null skill_id. */
export function extractTaskSkillTags(content: Content): { step: number; skill_id: string }[] {
  const tasks = content?.tasks ?? [];
  const out: { step: number; skill_id: string }[] = [];
  for (const t of tasks) {
    if (typeof t?.step === 'number' && typeof t?.skill_id === 'string' && t.skill_id) {
      out.push({ step: t.step, skill_id: t.skill_id });
    }
  }
  return out;
}

/**
 * Build ONE averaged homework observation per skill from per-task skill tags + per-task
 * grades. gradePct = round(mean of that skill's tagged task grades). Returns null when
 * there is nothing to attribute (no tags or no grades) — the caller then uses the
 * assignment-level observation for every skill.
 */
export function buildPerSkillHomeworkObs(
  taskTags: { step: number; skill_id: string }[],
  taskGrades: { step: number; grade: number }[],
  base: { submitted: boolean; occurredAt: string; effortLabel: string | null },
): Map<string, SkillHomeworkObservation> | null {
  if (taskTags.length === 0 || taskGrades.length === 0) return null;
  const gradeByStep = new Map(taskGrades.map((g) => [g.step, g.grade]));
  const gradesBySkill = new Map<string, number[]>();
  for (const tag of taskTags) {
    if (!gradeByStep.has(tag.step)) continue; // tagged task without a grade → skip
    if (!gradesBySkill.has(tag.skill_id)) gradesBySkill.set(tag.skill_id, []);
    gradesBySkill.get(tag.skill_id)!.push(gradeByStep.get(tag.step)!);
  }
  if (gradesBySkill.size === 0) return null;
  const out = new Map<string, SkillHomeworkObservation>();
  for (const [skillId, grades] of gradesBySkill) {
    const avg = Math.round(grades.reduce((a, b) => a + b, 0) / grades.length);
    out.set(skillId, { gradePct: avg, submitted: base.submitted, occurredAt: base.occurredAt, effortLabel: base.effortLabel });
  }
  return out;
}
