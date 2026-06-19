// Canonical role model (spec §1.2). The DB CHECK in migration 0001 carries the
// same 6 values; this is the code-side mirror. `school_sysadmin` is the 6th role
// V1 code depends on but the V1 000 enum omitted — reconciled here + in 0001.
export const ROLES = [
  'teacher', 'student', 'parent', 'school_admin', 'school_sysadmin', 'platform_admin',
] as const;
export type Role = (typeof ROLES)[number];

/** Roles routed through the School Admin route group + passing guardSchoolAdmin. */
export const SCHOOL_ADMIN_ROLES = ['school_admin', 'school_sysadmin', 'platform_admin'] as const;

/** All staff roles allowed to access teacher-facing API routes. */
export const STAFF_ROLES = ['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'] as const;

// CL_VERB_BY_STATE moved to src/lib/skills/clVerbs.ts (Plan 3 Task 16).
// Re-exported here for backward compatibility with existing importers.
export { CL_VERB_BY_STATE } from '@/lib/skills/clVerbs';
export type { SkillLearningState } from '@/lib/skills/clVerbs';
