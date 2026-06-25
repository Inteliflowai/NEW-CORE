// src/lib/copy/comprehensionObservation.ts
// The lead coach sentence on Insights — names the one skill most worth a reinforcement pass.
// Counts are teacher-only (OK, like the band-mix pills). Skips any skill whose teacher/AI name
// carries a banned coach-posture word (mirrors loadInsights' concept_gaps filter). DRAFT → Barb.
import type { SkillComprehension } from '@/lib/insights/loadClassComprehension';
import { hasBannedWord } from '@/lib/copy/leakGuard';

/** Names the top reinforce skill (skills are pre-sorted most-reinforce-first). null when none. */
export function comprehensionObservation(skills: SkillComprehension[]): string | null {
  const top = skills.find((s) => s.skill_name && !hasBannedWord(s.skill_name));
  if (!top) return null;
  const who = top.reinforce === 1 ? 'One student needs' : `${top.reinforce} students need`;
  return `${who} another pass on ${top.skill_name}.`;
}
