import { redirect } from 'next/navigation';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { ProfileForm } from './_components/ProfileForm';

export default async function ProfilePage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from('users')
    .select('full_name, email, avatar_url')
    .eq('id', user.id)
    .maybeSingle();

  const p = (data ?? {}) as { full_name?: string; email?: string; avatar_url?: string | null };

  return (
    <ProfileForm
      initialName={p.full_name ?? ''}
      email={p.email ?? ''}
      avatarUrl={p.avatar_url ?? null}
    />
  );
}
