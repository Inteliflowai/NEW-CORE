import { createServerSupabaseClient } from '@/lib/supabase/server';

/** Days the trial data stays available after expiry before removal. */
const RETENTION_DAYS = 14;

export default async function TrialExpired() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  let retentionDate: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from('users').select('school_id').eq('id', user.id).single();
    if (profile?.school_id) {
      const { data: school } = await supabase
        .from('schools').select('trial_expires_at').eq('id', profile.school_id).single();
      if (school?.trial_expires_at) {
        const d = new Date(school.trial_expires_at);
        d.setDate(d.getDate() + RETENTION_DAYS);
        retentionDate = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      }
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="w-full max-w-md rounded-lg bg-surface p-8 shadow-pop text-center">
        <span className="font-display font-bold text-brand text-2xl tracking-tight">◆ CORE</span>
        <h1 className="mt-4 mb-2 text-xl font-display text-fg">Your trial has ended</h1>
        <p className="mb-2 text-sm text-fg">
          Thanks for trying CORE. To keep your class&apos;s insights, reach out and we&apos;ll get you set up.
        </p>
        {retentionDate && (
          <p className="mb-6 text-sm text-fg">Your trial data stays available until <strong>{retentionDate}</strong>.</p>
        )}
        <a href="mailto:hello@inteliflowai.com" className="inline-block rounded bg-brand px-4 py-2 font-medium text-fg-on-brand">
          Contact us
        </a>
        {/* Sign-out is a POST form, NOT a <Link> — a Link would let Next prefetch fire the logout. */}
        <form action="/logout" method="post" className="mt-6">
          <button type="submit" className="text-sm text-fg-muted hover:text-brand">Sign out</button>
        </form>
      </div>
    </div>
  );
}
