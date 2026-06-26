// src/lib/skills/skillTargets.ts
// Pure helpers mapping a student's per-skill Comprehension Level to a per-skill
// assignment level, with a conservative confidence gate + a Reinforce-first cap.
import type { AssignmentMode } from '@/types/core';

export type CLVerb = 'Reinforce' | 'On Track' | 'Enrich';

export interface SkillTarget {
  skill_id: string;
  skill_name: string;
  level: AssignmentMode;     // 'scaffolded' | 'standard' | 'extension'
  verb: CLVerb | null;       // null = cold / not-yet-assessed
  confident: boolean;        // verb present AND confidence >= CONFIDENCE_STEER_MIN
}

export const SKILL_TARGET_CAP = 4;
export const CONFIDENCE_STEER_MIN = 40;

const LEVEL_BY_VERB: Record<CLVerb, AssignmentMode> = {
  Reinforce: 'scaffolded',
  'On Track': 'standard',
  Enrich: 'extension',
};

/** Conservative gate: only a present verb with confidence >= 40 steers; else fallback. */
export function levelForVerb(
  verb: CLVerb | null,
  confidence: number | null,
  fallback: AssignmentMode,
): AssignmentMode {
  if (verb == null) return fallback;
  if (confidence == null || confidence < CONFIDENCE_STEER_MIN) return fallback;
  return LEVEL_BY_VERB[verb];
}

const VERB_ORDER: Record<string, number> = { Reinforce: 0, 'On Track': 1, Enrich: 2 };

/** Reinforce-first → On Track → Enrich → cold(null) last; cap at 4 (warn on truncation). */
export function orderAndCapTargets(targets: SkillTarget[]): SkillTarget[] {
  const sorted = [...targets].sort(
    (a, b) => (VERB_ORDER[a.verb ?? ''] ?? 3) - (VERB_ORDER[b.verb ?? ''] ?? 3),
  );
  if (sorted.length > SKILL_TARGET_CAP) {
    console.warn(`[skillTargets] ${sorted.length} skills resolved — capping to ${SKILL_TARGET_CAP} (Reinforce-first)`);
    return sorted.slice(0, SKILL_TARGET_CAP);
  }
  return sorted;
}
