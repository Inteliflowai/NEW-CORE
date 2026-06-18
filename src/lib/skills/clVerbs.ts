// src/lib/skills/clVerbs.ts
// CL verb display layer over the 6 skill_learning_state values (spec §3.2).
// Moved here from src/lib/auth/roles.ts (Plan 3 Task 16 — cleaner home in skills lib).
//
// null = cold-start "Not yet assessed" (never a fabricated verb).
// DB enum is internal-only; the teacher never sees the raw state.

export type SkillLearningState =
  | 'needs_different_instruction'
  | 'needs_more_time'
  | 'on_track'
  | 'ready_to_extend'
  | 'insufficient_data'
  | 'not_attempted';

/** Map skill_learning_state → CL verb shown in teacher UI.
 *  null means cold-start → render "Not yet assessed". */
export const CL_VERB_BY_STATE: Record<SkillLearningState, 'Reinforce' | 'On Track' | 'Enrich' | null> = {
  needs_different_instruction: 'Reinforce',
  needs_more_time: 'Reinforce',
  on_track: 'On Track',
  ready_to_extend: 'Enrich',
  insufficient_data: null,
  not_attempted: null,
} as const;
