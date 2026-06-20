// src/app/(teacher)/_components/SummaryCallout.tsx
// Pop-Art "caption" strip for the at-a-glance class summary sentence. Replaces
// the flat gray line with a branded callout: the WCAG-validated brand-surface /
// brand-fg pair, the hard ink edge, a sticker shadow, and a tilted star chip
// (bg-brand / fg-on-brand — also a validated pair). Token-only, deep-ink text.

import React from 'react';

export function SummaryCallout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border-2 border-sidebar-edge bg-brand-surface px-3.5 py-2 shadow-sticker">
      <span
        aria-hidden
        className="grid size-5 shrink-0 -rotate-6 place-items-center rounded border-2 border-sidebar-edge bg-brand text-[11px] font-black text-fg-on-brand"
      >
        ★
      </span>
      <p className="text-[13px] font-semibold text-brand-fg">{children}</p>
    </div>
  );
}

export default SummaryCallout;
