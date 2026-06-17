// Canonical role model (spec §1.2). The DB CHECK in migration 0001 carries the
// same 6 values; this is the code-side mirror. `school_sysadmin` is the 6th role
// V1 code depends on but the V1 000 enum omitted — reconciled here + in 0001.
export const ROLES = [
  'teacher', 'student', 'parent', 'school_admin', 'school_sysadmin', 'platform_admin',
] as const;
export type Role = (typeof ROLES)[number];

/** Roles routed through the School Admin route group + passing guardSchoolAdmin. */
export const SCHOOL_ADMIN_ROLES = ['school_admin', 'school_sysadmin', 'platform_admin'] as const;

/** CL verb display layer over the 6 skill_learning_state values (spec §3.2).
 *  null = cold-start "Not yet assessed" (never a fabricated verb). DB enum is
 *  internal-only; the teacher never sees the raw state. */
export const CL_VERB_BY_STATE = {
  needs_different_instruction: 'Reinforce',
  needs_more_time: 'Reinforce',
  on_track: 'On Track',
  ready_to_extend: 'Enrich',
  insufficient_data: null,
  not_attempted: null,
} as const;
