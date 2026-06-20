// src/app/(teacher)/_components/SummaryCallout.tsx
// Pop-Art "caption" strip for the at-a-glance class summary sentence. Replaces
// the flat gray line with a branded callout: the WCAG-validated brand-surface /
// brand-fg pair, the hard ink edge, a sticker shadow, and a tilted star chip
// (bg-brand / fg-on-brand — also a validated pair). Token-only, deep-ink text.

import React from 'react';

export function SummaryCallout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 rounded-lg border-2 border-sidebar-edge bg-brand-surface px-4 py-3 shadow-sticker">
      <span
        aria-hidden
        className="mt-px grid size-6 shrink-0 -rotate-6 place-items-center rounded-md border-2 border-sidebar-edge bg-brand text-[13px] font-black text-fg-on-brand"
      >
        ★
      </span>
      <p className="text-sm font-semibold text-brand-fg">{children}</p>
    </div>
  );
}

export default SummaryCallout;
