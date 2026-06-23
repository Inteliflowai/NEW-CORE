// Signature-Moment FEEL prototype — isolated dev/demo route (no auth, no shell).
// Plays the coach "notices and speaks" moment in three registers. Mock data only.
import React from 'react';
import { SignatureMoment } from './SignatureMoment';

export const metadata = { title: 'Signature Moment — feel prototype' };

export default function SignatureMomentPage(): React.JSX.Element {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <header className="flex flex-col items-center gap-1 text-center">
        <p className="text-fg-muted text-[11px] font-bold uppercase tracking-[0.18em]">CORE · feel prototype</p>
        <h1 className="font-display text-2xl font-extrabold text-fg">The signature moment</h1>
        <p className="text-fg-muted max-w-md text-sm">
          The coach notices one thing and speaks — then gets out of the way. Same beat, three feelings.
        </p>
      </header>
      <SignatureMoment />
    </main>
  );
}
