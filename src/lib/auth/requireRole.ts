import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { homeForRole } from '@/lib/auth/roleHome';
import type { Role } from '@/lib/auth/roles';

export interface AuthedContext {
  userId: string;
  role: Role;
  schoolId: string | null;
}

/**
 * Server-layout authorization guard. Resolves the session via getUser(),
 * enforces the role allow-list, and applies the trial-expiry gate.
 * Redirects (throws NEXT_REDIRECT) on any failure; returns the context when allowed.
 */
export async function requireRole(allowed: readonly Role[]): Promise<AuthedContext> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?expired=true');

  const { data: profile } = await supabase
    .from('users').select('role, school_id').eq('id', user.id).single();
  const role = (profile?.role ?? null) as Role | null;
  if (!role) redirect('/login');

  const schoolId = (profile?.school_id ?? null) as string | null;
  if (schoolId) {
    const { data: school } = await supabase
      .from('schools').select('trial_status').eq('id', schoolId).single();
    if (school?.trial_status === 'expired') redirect('/trial-expired');
  }

  if (!allowed.includes(role)) redirect(homeForRole(role));

  return { userId: user.id, role, schoolId };
}
