import type { Role } from '@/lib/auth/roles';

/**
 * Post-auth landing path per DB role. These are the "Dashboard" destinations the
 * existing route-group navs already link to (teacher → /today and platform_admin →
 * /provision are built; the rest are Phase-1 placeholder pages at the nav's
 * Dashboard target so the primary nav link works and there are no orphan routes).
 */
export const ROLE_HOME: Record<Role, string> = {
  teacher: '/today',
  student: '/student/dashboard',
  parent: '/parent/dashboard',
  school_admin: '/admin/dashboard',
  school_sysadmin: '/admin/dashboard',
  platform_admin: '/provision',
};

/** Home path for a (possibly unknown) role string; /login when unresolved. */
export function homeForRole(role: string | null | undefined): string {
  if (role && role in ROLE_HOME) return ROLE_HOME[role as Role];
  return '/login';
}
