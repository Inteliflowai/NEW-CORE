// src/lib/auth/adminCapabilities.ts
// What a customer-school admin role may see. The IT role (school_sysadmin) is
// operational-only; the academic head (school_admin) + platform_admin see the
// student-attention pedagogy layer. (Spec §Roles & capability gating.)
export interface AdminCapabilities {
  canSeeStudentAttention: boolean;
}
export function adminCapabilities(role: string): AdminCapabilities {
  return { canSeeStudentAttention: role === 'school_admin' || role === 'platform_admin' };
}
