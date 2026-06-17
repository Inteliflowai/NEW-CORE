import { describe, it, expect } from 'vitest';
import { ROLES, SCHOOL_ADMIN_ROLES, CL_VERB_BY_STATE } from '@/lib/auth/roles';

describe('role model', () => {
  it('has all 6 roles incl. the code-only school_sysadmin (spec §1.2)', () => {
    expect(ROLES).toEqual([
      'teacher', 'student', 'parent', 'school_admin', 'school_sysadmin', 'platform_admin',
    ]);
  });
  it('treats school_sysadmin as a school-admin-tier role', () => {
    expect(SCHOOL_ADMIN_ROLES).toContain('school_sysadmin');
    expect(SCHOOL_ADMIN_ROLES).toContain('school_admin');
    expect(SCHOOL_ADMIN_ROLES).toContain('platform_admin');
  });
});

describe('CL verb mapping (6 states -> 3 verbs + cold-start)', () => {
  it('maps the 6 skill_learning_state values to teacher verbs', () => {
    expect(CL_VERB_BY_STATE.needs_different_instruction).toBe('Reinforce');
    expect(CL_VERB_BY_STATE.needs_more_time).toBe('Reinforce');
    expect(CL_VERB_BY_STATE.on_track).toBe('On Track');
    expect(CL_VERB_BY_STATE.ready_to_extend).toBe('Enrich');
    expect(CL_VERB_BY_STATE.insufficient_data).toBeNull();
    expect(CL_VERB_BY_STATE.not_attempted).toBeNull();
  });
});
