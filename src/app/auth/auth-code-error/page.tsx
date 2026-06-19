import Link from 'next/link';

export default function AuthCodeError() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="w-full max-w-sm rounded-lg bg-surface p-8 shadow-pop text-center">
        <span className="font-display font-bold text-brand text-2xl tracking-tight">◆ CORE</span>
        <h1 className="mt-4 mb-2 text-lg font-display text-fg">That link didn&apos;t work</h1>
        <p className="mb-6 text-sm text-fg">Your sign-in link may have expired. Request a new one.</p>
        <Link href="/login" className="inline-block rounded bg-brand px-4 py-2 font-medium text-fg-on-brand">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
