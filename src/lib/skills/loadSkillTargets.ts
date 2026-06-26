// src/lib/skills/loadSkillTargets.ts
// Loads a student's per-skill Comprehension Level for a given set of skills and
// maps each to a per-skill assignment level (confidence-gated). Cold / low-confidence
// skills fall back to the anchor band's mode. Admin-client read; the caller has already
// established the student via the route's IDOR guard.
import type { SupabaseClient } from '@supabase/supabase-js';
import { CL_VERB_BY_STATE, type SkillLearningState } from '@/lib/skills/clVerbs';
import { bandToAssignmentMode } from '@/lib/utils/scoring';
import type { MasteryBand } from '@/types/core';
import { levelForVerb, orderAndCapTargets, CONFIDENCE_STEER_MIN, type SkillTarget } from '@/lib/skills/skillTargets';

export async function loadSkillTargets(
  admin: SupabaseClient,
  args: { studentId: string; skills: { skill_id: string; skill_name: string }[]; fallbackBand: MasteryBand },
): Promise<SkillTarget[]> {
  if (args.skills.length === 0) return [];
  const fallbackMode = bandToAssignmentMode(args.fallbackBand);
  const ids = args.skills.map((s) => s.skill_id);

  const { data } = await admin
    .from('skill_learning_state')
    .select('skill_id, state, confidence')
    .eq('student_id', args.studentId)
    .in('skill_id', ids);

  const byId = new Map<string, { state: string; confidence: number | null }>();
  for (const r of (data ?? []) as { skill_id: string; state: string; confidence: number | null }[]) {
    byId.set(r.skill_id, { state: r.state, confidence: r.confidence });
  }

  const targets: SkillTarget[] = args.skills.map((s) => {
    const row = byId.get(s.skill_id);
    const verb = row ? CL_VERB_BY_STATE[row.state as SkillLearningState] ?? null : null;
    const confidence = row?.confidence ?? null;
    return {
      skill_id: s.skill_id,
      skill_name: s.skill_name,
      level: levelForVerb(verb, confidence, fallbackMode),
      verb,
      confident: verb != null && confidence != null && confidence >= CONFIDENCE_STEER_MIN,
    };
  });

  return orderAndCapTargets(targets);
}
