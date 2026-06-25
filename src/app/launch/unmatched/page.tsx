// Public no-match page for the silent-SSO launch (GC Seg 4). Shown when a student's Google account
// can't be matched to a CORE student. Coach-posture: plain, reassuring, never reveals whether an
// account exists. Public — see PUBLIC_PREFIXES in src/proxy.ts.
import React from 'react';
import Link from 'next/link';

export default function LaunchUnmatched(): React.JSX.Element {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-surface bg-surface p-8 flex flex-col gap-4 text-center">
        <h1 className="font-display text-2xl font-semibold text-fg">We couldn't match your Google account</h1>
        <p className="text-sm leading-relaxed text-fg">
          We couldn't connect this Google account to your CORE account yet. You can sign in with your
          CORE password, or ask your teacher to add you.
        </p>
        <Link
          href="/login"
          className="self-center rounded-lg bg-brand px-5 py-2.5 text-sm font-bold text-fg-on-brand"
        >
          Sign in with CORE
        </Link>
      </div>
    </main>
  );
}
