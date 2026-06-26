// src/lib/school/resolveAdminContext.ts
// Server-component auth + scope resolver for the (school-admin) surface.
// requireRole redirects on unauth/wrong-role/trial-expiry. Resolves the EFFECTIVE
// schoolId: school-scoped admins get their own school; platform_admin gets ?school=
// (or null → the page renders a "pick a school" state). Never lets a non-platform
// role override its school.
import { requireRole } from '@/lib/auth/requireRole';
import { SCHOOL_ADMIN_ROLES } from '@/lib/auth/roles';
import { adminCapabilities, type AdminCapabilities } from '@/lib/auth/adminCapabilities';

export interface AdminContext {
  userId: string;
  role: string;
  fullName: string | null;
  schoolId: string | null;
  isPlatform: boolean;
  caps: AdminCapabilities;
}

export async function resolveAdminContext(searchParams?: { school?: string }): Promise<AdminContext> {
  const ctx = await requireRole(SCHOOL_ADMIN_ROLES);
  const isPlatform = ctx.role === 'platform_admin';
  // CRITICAL FIX (pre-code review): isPlatform with no ?school= MUST yield null,
  // not fall back to the platform admin's own (Inteliflow) schoolId.
  const schoolId = isPlatform ? (searchParams?.school ?? null) : ctx.schoolId;
  return { userId: ctx.userId, role: ctx.role, fullName: ctx.fullName, schoolId, isPlatform, caps: adminCapabilities(ctx.role) };
}
