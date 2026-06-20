'use client';

import { Suspense, useState, useEffect } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { homeForRole } from '@/lib/auth/roleHome';
import { IconBolt } from '@/components/core/icons';
import BackgroundRotator from './_components/BackgroundRotator';

type Mode = 'signin' | 'magic' | 'forgot';

const ERROR_COPY: Record<string, string> = {
  auth_failed: 'Sign-in failed. Please try again.',
  reset_expired: 'That reset link has expired. Request a new one below.',
  not_provisioned: 'No CORE account found for that email.',
};

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  // Create the browser client ONCE — not on every render (state changes re-render).
  const [supabase] = useState(() => createBrowserSupabaseClient());

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(ERROR_COPY[params.get('error') ?? ''] ?? null);
  const [success, setSuccess] = useState<string | null>(null);
  const expired = params.get('expired') === 'true';
  const [showExpired, setShowExpired] = useState(expired);
  useEffect(() => {
    if (!expired) return;
    const t = setTimeout(() => setShowExpired(false), 5000);
    return () => clearTimeout(t);
  }, [expired]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null); setSuccess(null);
    try {
      if (mode === 'signin') {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) { setError(error.message); return; }
        const { data: profile } = await supabase
          .from('users').select('role').eq('id', data.user!.id).single();
        router.push(homeForRole(profile?.role ?? null));
        router.refresh();
      } else if (mode === 'magic') {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) { setError(error.message); return; }
        setSuccess('Check your email for a one-click sign-in link.');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback?next=/set-password`,
        });
        if (error) { setError(error.message); return; }
        setSuccess('Check your email for a password-reset link.');
      }
    } finally {
      setLoading(false);
    }
  }

  const submitLabel = loading ? 'Please wait…'
    : mode === 'signin' ? 'Sign in to CORE'
    : mode === 'magic' ? 'Send magic link'
    : 'Send reset link';

  return (
    <div className="relative min-h-screen overflow-hidden" style={{ backgroundColor: 'var(--ink-950)' }}>
      {/* Full-bleed rotating pop-art gallery — the hero / first impression */}
      <BackgroundRotator />

      {/* Brand billboard over the art (white CORE mark for dark backgrounds) */}
      <div className="pointer-events-none absolute left-6 top-6 z-10 flex flex-col gap-2 sm:left-10 sm:top-9">
        <Image
          src="/images/brand/core-logo.png"
          alt="CORE"
          width={1108}
          height={466}
          priority
          className="h-10 w-auto sm:h-12"
          style={{ filter: 'drop-shadow(0 2px 10px rgb(0 0 0 / 0.6))' }}
        />
        <span
          className="inline-flex items-center gap-1.5 text-sm font-semibold"
          style={{ color: 'var(--white)', textShadow: '0 1px 8px rgb(0 0 0 / 0.75)' }}
        >
          Learning Intelligence · with
          <Image src="/images/brand/spark.svg" alt="SPARK" width={1071} height={481} className="h-4 w-auto" />
        </span>
      </div>

      {/* Sign-in card — floats to the side so the art stays the hero */}
      <div className="absolute inset-0 z-10 flex items-center justify-center p-6 sm:justify-end sm:p-10 lg:pr-24 xl:pr-40">
        <div className="relative w-full max-w-sm rounded-xl border-2 border-sidebar-edge bg-surface p-7 shadow-sticker-lg">
          {/* Lime bolt sticker tab — the signature, echoes the teacher rail's active sticker */}
          <span
            aria-hidden
            className="absolute -right-3 -top-3 grid size-10 -rotate-12 place-items-center rounded-xl border-2 border-sidebar-edge bg-sidebar-active text-sidebar-active-fg shadow-sticker"
          >
            <IconBolt className="size-5" />
          </span>

          <div className="mb-5">
            <h1 className="font-display text-2xl font-bold tracking-tight text-fg">
              {mode === 'forgot' ? 'Reset your password' : 'Welcome back'}
            </h1>
            <p className="mt-1 text-sm text-fg-muted">
              {mode === 'forgot'
                ? "Enter your email and we'll send you a reset link."
                : 'Sign in to your CORE account.'}
            </p>
          </div>

          {/* Mode toggle (hidden in forgot) */}
          {mode !== 'forgot' && (
            <div className="mb-5 inline-flex rounded bg-bg p-1" role="tablist">
              <button type="button" role="tab" aria-selected={mode === 'signin'} onClick={() => setMode('signin')}
                className={`px-3 py-1 text-sm rounded ${mode === 'signin' ? 'bg-surface text-fg shadow' : 'text-fg-muted'}`}>
                Password
              </button>
              <button type="button" role="tab" aria-selected={mode === 'magic'} onClick={() => setMode('magic')}
                className={`px-3 py-1 text-sm rounded ${mode === 'magic' ? 'bg-surface text-fg shadow' : 'text-fg-muted'}`}>
                Magic Link
              </button>
            </div>
          )}

          {showExpired && (
            <div role="status" className="mb-4 rounded bg-warn-surface text-warn-fg px-3 py-2 text-sm">
              Your session expired, please sign in again.
            </div>
          )}
          {error && (
            <div role="alert" className="mb-4 rounded bg-risk-surface text-risk-fg px-3 py-2 text-sm">
              {error}
            </div>
          )}
          {success && (
            <div role="status" className="mb-4 rounded bg-ok-surface text-ok-fg px-3 py-2 text-sm">
              {success}
            </div>
          )}

          {mode === 'forgot' && (
            <button type="button" onClick={() => setMode('signin')}
              className="mb-3 text-sm text-fg-muted hover:text-brand">← Back to sign in</button>
          )}

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            {/* Explicit htmlFor/id (not wrapping labels) so accessible names stay
                clean — a wrapping label would fold the Forgot/Show button text into
                the field's name and break getByLabelText('Password'). */}
            <div className="flex flex-col gap-1 text-sm text-fg">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                autoComplete="email" placeholder="you@school.edu"
                className="rounded border border-fg-muted bg-bg px-3 py-2 text-base text-fg" />
            </div>

            {mode === 'signin' && (
              <div className="flex flex-col gap-1 text-sm text-fg">
                <span className="flex items-center justify-between">
                  <label htmlFor="password">Password</label>
                  <button type="button" onClick={() => setMode('forgot')}
                    className="text-xs text-fg-muted hover:text-brand">Forgot?</button>
                </span>
                <span className="relative">
                  <input id="password" type={showPw ? 'text' : 'password'} required value={password}
                    onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
                    className="w-full rounded border border-fg-muted bg-bg px-3 py-2 text-base text-fg" />
                  <button type="button" onClick={() => setShowPw((s) => !s)}
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-fg-muted">
                    {showPw ? 'Hide' : 'Show'}
                  </button>
                </span>
              </div>
            )}

            {mode === 'magic' && (
              <p className="text-sm text-fg-muted">We&apos;ll email you a one-click link. No password needed.</p>
            )}

            <button type="submit" disabled={loading}
              className="rounded bg-brand px-4 py-2 font-medium text-fg-on-brand disabled:opacity-60">
              {submitLabel}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-fg-muted">CORE · Inteliflow AI · FERPA compliant</p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ backgroundColor: 'var(--ink-950)' }} />}>
      <LoginInner />
    </Suspense>
  );
}
