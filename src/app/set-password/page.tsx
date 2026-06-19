'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export default function SetPasswordPage() {
  const router = useRouter();
  const [supabase] = useState(() => createBrowserSupabaseClient());
  const [ready, setReady] = useState(false);
  const [noLink, setNoLink] = useState(false); // no recovery session arrived → fallback
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let settled = false;
    const markReady = () => {
      settled = true;
      setReady(true);
    };
    // Stop spinning after a few seconds if no recovery/sign-in session arrives,
    // and show an actionable fallback instead of hanging forever (spec §5.2).
    const timer = setTimeout(() => {
      if (!settled) setNoLink(true);
    }, 3000);

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        clearTimeout(timer);
        markReady();
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        clearTimeout(timer);
        markReady();
      }
    });

    return () => {
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setError(error.message); return; }
    setDone(true);
    setTimeout(() => router.push('/login'), 1500);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="w-full max-w-sm rounded-lg bg-surface p-8 shadow-pop">
        <span className="font-display font-bold text-brand text-2xl tracking-tight">◆ CORE</span>
        <h1 className="mt-4 mb-1 text-lg font-display text-fg">Set your password</h1>
        {!ready ? (
          noLink ? (
            <div className="mt-2">
              <p role="alert" className="rounded bg-risk-surface text-risk-fg px-3 py-2 text-sm">
                This reset link is invalid or has expired.
              </p>
              <Link href="/login" className="mt-3 inline-block text-sm text-brand">Back to sign in</Link>
            </div>
          ) : (
            <p className="text-sm text-fg">Verifying your reset link…</p>
          )
        ) : done ? (
          <p role="status" className="rounded bg-ok-surface text-ok-fg px-3 py-2 text-sm">
            Password updated! Redirecting…
          </p>
        ) : (
          <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
            {error && (
              <div role="alert" className="rounded bg-risk-surface text-risk-fg px-3 py-2 text-sm">{error}</div>
            )}
            <label className="flex flex-col gap-1 text-sm text-fg">
              New password
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password" className="rounded border border-fg-muted bg-bg px-3 py-2 text-base text-fg" />
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg">
              Confirm password
              <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password" className="rounded border border-fg-muted bg-bg px-3 py-2 text-base text-fg" />
            </label>
            <button type="submit" className="rounded bg-brand px-4 py-2 font-medium text-fg-on-brand">Set password</button>
          </form>
        )}
      </div>
    </div>
  );
}
