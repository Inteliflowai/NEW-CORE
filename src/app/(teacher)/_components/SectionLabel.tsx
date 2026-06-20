// src/app/(teacher)/_components/SectionLabel.tsx
// Pop-Art section label — a solid colour sticker chip (same language as the Today/
// Roster card labels). All tone pairs are WCAG-AA verified (amber/ink 8.35,
// emerald/ink 4.76, cobalt/white 5.17, coral/ink 4.69, lime/ink high). Token-only.

import React from 'react';

type Tone = 'brand' | 'ok' | 'warn' | 'risk' | 'lime';

const TONE: Record<Tone, string> = {
  brand: 'bg-brand text-fg-on-brand',
  ok: 'bg-ok text-fg',
  warn: 'bg-warn text-fg',
  risk: 'bg-risk text-fg',
  lime: 'bg-sidebar-active text-sidebar-active-fg',
};

export function SectionLabel({
  children,
  tone = 'brand',
}: {
  children: React.ReactNode;
  tone?: Tone;
}): React.JSX.Element {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-md border-2 border-sidebar-edge px-2.5 py-1 font-display text-[13px] font-extrabold uppercase tracking-wide shadow-sticker ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

export default SectionLabel;
