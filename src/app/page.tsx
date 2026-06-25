import { redirect } from 'next/navigation';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { homeForRole } from '@/lib/auth/roleHome';
import { resolveGcDeepLink } from '@/lib/google/launchResolve';
import { safeStudentDest } from '@/lib/google/launchState';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ gc?: string; id?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single();
  const role = profile?.role ?? null;

  // An already-logged-in student following the Open-CORE deep-link goes straight to the work
  // (their OWN row — four-audience). resolveGcDeepLink finds only assignments where student_id =
  // the caller, so no school derivation is needed here.
  const gc = (sp.gc ?? '').trim();
  const id = (sp.id ?? '').trim();
  if (role === 'student' && (gc === 'quiz' || gc === 'assignment') && id) {
    const admin = createAdminSupabaseClient();
    const dest = safeStudentDest(await resolveGcDeepLink(admin, { studentId: user.id, gc, id }));
    redirect(dest);
  }

  redirect(homeForRole(role));
}
