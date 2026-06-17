// Object-level authz for API route handlers (LIFT V1 lib/auth/guards.ts; finding C3).
// The service-role admin client BYPASSES RLS — these guards are the ONLY access
// control on admin-client cross-user reads. RLS is NOT the backstop here.
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { SCHOOL_ADMIN_ROLES } from '@/lib/auth/roles';

const PLATFORM_ROLE = 'platform_admin';

function isSchoolAdmin(role: string | null): boolean {
  return !!role && (SCHOOL_ADMIN_ROLES as readonly string[]).includes(role);
}

const UNAUTH = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
const FORBID = () => NextResponse.json({ error: 'Forbidden' }, { status: 403 });

/** Resolve the authenticated caller's id + role from the session, or null. */
async function resolveCaller(): Promise<{ id: string; role: string | null; school_id: string | null } | null> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser(); // getUser, not getSession
  if (!user) return null;
  const { data: profile } = await supabase
    .from('users').select('role, school_id').eq('id', user.id).single();
  return { id: user.id, role: profile?.role ?? null, school_id: profile?.school_id ?? null };
}

/**
 * Require a platform_admin caller. Returns a 401/403 NextResponse to
 * short-circuit the handler, or null if the caller is a platform admin.
 */
export async function guardPlatformAdmin(): Promise<NextResponse | null> {
  const caller = await resolveCaller();
  if (!caller) return UNAUTH();
  if (caller.role !== PLATFORM_ROLE) return FORBID();
  return null;
}

/**
 * Require a school-admin-tier caller (school_admin / school_sysadmin /
 * platform_admin). On success returns { schoolId, role, userId, isPlatformAdmin }
 * so the handler can scope queries; on failure returns { error: NextResponse }.
 * Check the discriminant: `if ('error' in r) return r.error;`
 *
 * IMPORTANT — platform_admin scope: when `isPlatformAdmin` is true, `schoolId`
 * is null (unrestricted access to all schools). Callers MUST check
 * `isPlatformAdmin` before using `schoolId` in a `.eq('school_id', schoolId)`
 * filter — passing null into that filter silently mis-scopes to all rows.
 * Pattern: `if (!r.isPlatformAdmin) query = query.eq('school_id', r.schoolId);`
 */
export async function guardSchoolAdmin(): Promise<
  | { error: NextResponse }
  | { schoolId: string | null; role: string; userId: string; isPlatformAdmin: boolean }
> {
  const caller = await resolveCaller();
  if (!caller) return { error: UNAUTH() };
  if (!(SCHOOL_ADMIN_ROLES as readonly string[]).includes(caller.role as string)) {
    return { error: FORBID() };
  }
  const isPlatformAdmin = caller.role === PLATFORM_ROLE;
  return { schoolId: caller.school_id, role: caller.role as string, userId: caller.id, isPlatformAdmin };
}

/**
 * Require the caller to be able to see a specific class: the teacher who owns
 * it, a same-school admin, or a platform admin. Returns 401/403 NextResponse
 * on denial, null to proceed. Blocks the cross-class IDOR on aggregate reads.
 */
export async function guardClassAccess(classId: string): Promise<NextResponse | null> {
  const caller = await resolveCaller();
  if (!caller) return UNAUTH();
  if (caller.role === PLATFORM_ROLE) return null;
  const admin = createAdminSupabaseClient();
  const { data: cls } = await admin.from('classes').select('teacher_id, school_id').eq('id', classId).maybeSingle();
  if (!cls) return FORBID(); // 403 not 404 — don't leak existence
  if (cls.teacher_id === caller.id) return null;
  if (isSchoolAdmin(caller.role) && cls.school_id && cls.school_id === caller.school_id) return null;
  return FORBID();
}

/**
 * Require the caller to be able to see a specific student: the student
 * themselves, a teacher who teaches them (enrollment in one of the caller's
 * classes), the linked parent, a same-school admin, or a platform admin.
 * Returns 401/403 NextResponse on denial, null to proceed.
 */
export async function guardStudentAccess(studentId: string): Promise<NextResponse | null> {
  const caller = await resolveCaller();
  if (!caller) return UNAUTH();
  if (caller.id === studentId) return null;
  if (caller.role === PLATFORM_ROLE) return null;
  const admin = createAdminSupabaseClient();
  const { data: stu } = await admin.from('users').select('school_id, parent_id').eq('id', studentId).maybeSingle();
  if (!stu) return FORBID();
  if (isSchoolAdmin(caller.role) && stu.school_id && stu.school_id === caller.school_id) return null;
  if (caller.role === 'parent' && stu.parent_id === caller.id) return null;
  if (caller.role === 'teacher') {
    const { data: classes } = await admin.from('classes').select('id').eq('teacher_id', caller.id);
    const classIds = (classes ?? []).map((c: { id: string }) => c.id);
    if (classIds.length) {
      const { data: enr } = await admin
        .from('enrollments').select('id').eq('student_id', studentId).in('class_id', classIds).limit(1).maybeSingle();
      if (enr) return null;
    }
  }
  return FORBID();
}
