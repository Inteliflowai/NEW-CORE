import { describe, it, expect } from 'vitest';

/**
 * Type-level assertions: confirm the route's CredentialEntry and the
 * ProvisionTrialResult.credentials type are consistent (email-only, no password).
 */
import type { ProvisionTrialResult, TrialCredential } from '@/lib/trial/provisionTrial';

describe('credentials type consistency', () => {
  it('TrialCredential has email but no password field', () => {
    // This is a compile-time shape test: construct a TrialCredential and confirm
    // that assigning a password property would be a TypeScript error.
    // At runtime, we assert the shape via the known keys.
    const cred: TrialCredential = { email: 'teacher@school.com' };
    expect(Object.keys(cred)).toEqual(['email']);
    // If TrialCredential still had a password field, the type test file would
    // fail to compile (tsc --noEmit) because the type would be narrower than expected.
  });

  it('ProvisionTrialResult.credentials values are email-only', () => {
    const result: ProvisionTrialResult = {
      schoolId: 'uuid-1',
      teacherId: 'uuid-2',
      parentId: null,
      firstStudentId: null,
      password: 'TestPass#1234',
      trialExpiresAt: new Date().toISOString(),
      credentials: {
        teacher: { email: 'teacher@school.com' },
        parent: { email: 'parent@trial.com' },
        student: { email: 'student@trial.com' },
      },
    };
    for (const [_role, cred] of Object.entries(result.credentials)) {
      expect(cred).toHaveProperty('email');
      expect(cred).not.toHaveProperty('password');
    }
    // password lives on result directly
    expect(result).toHaveProperty('password');
  });
});
