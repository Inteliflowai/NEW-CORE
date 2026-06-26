import { describe, it, expect } from 'vitest';
import { adminCapabilities } from '@/lib/auth/adminCapabilities';

describe('adminCapabilities', () => {
  it('grants student-attention to the academic head + platform admin', () => {
    expect(adminCapabilities('school_admin').canSeeStudentAttention).toBe(true);
    expect(adminCapabilities('platform_admin').canSeeStudentAttention).toBe(true);
  });
  it('denies student-attention to IT (school_sysadmin) and anyone else', () => {
    expect(adminCapabilities('school_sysadmin').canSeeStudentAttention).toBe(false);
    expect(adminCapabilities('teacher').canSeeStudentAttention).toBe(false);
    expect(adminCapabilities('').canSeeStudentAttention).toBe(false);
  });
});
