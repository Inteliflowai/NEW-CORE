// src/app/(teacher)/students/[studentId]/_lib/skillMapOrder.ts
//
// Pure ordering + classification helpers for the Skill Map matrix.
// Reinforce → Not-yet → On Track → Enrich. The green/Enrich tail is capped
// behind a "show all" by the caller using `isTailRow`.

import type { PerSkillCL } from '@/lib/signals/loadStudentSignals';

export type SkillMapTone = 'reinforce' | 'on-track' | 'enrich' | 'not-yet';

/** Maps a CL verb / null to the matrix tone used for the color rail. */
export function skillTone(verb: PerSkillCL['cl_verb']): SkillMapTone {
  switch (verb) {
    case 'Reinforce':
      return 'reinforce';
    case 'On Track':
      return 'on-track';
    case 'Enrich':
      return 'enrich';
    default:
      return 'not-yet';
  }
}

// Sort precedence: Reinforce first (most actionable), then Not-yet, then On Track,
// then Enrich (the calm "tail" capped behind show-all).
const TONE_RANK: Record<SkillMapTone, number> = {
  reinforce: 0,
  'not-yet': 1,
  'on-track': 2,
  enrich: 3,
};

export function sortSkillMap<T extends { cl_verb: PerSkillCL['cl_verb'] }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => TONE_RANK[skillTone(a.cl_verb)] - TONE_RANK[skillTone(b.cl_verb)]);
}

/**
 * The "tail" that gets collapsed behind "show all" = On Track + Enrich rows
 * (the calm/green end). Reinforce + Not-yet are always visible.
 */
export function isTailRow(verb: PerSkillCL['cl_verb']): boolean {
  const tone = skillTone(verb);
  return tone === 'on-track' || tone === 'enrich';
}
