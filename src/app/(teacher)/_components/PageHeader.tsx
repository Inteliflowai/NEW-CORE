// src/app/(teacher)/_components/PageHeader.tsx
// Pop-Art page header for teacher screens: a punchy display title with a tilted
// sticker accent + a short underline bar, optional eyebrow kicker, optional
// right-aligned action slot. Token-only — the accent colors are decorative bg
// blocks (no text on them), so the WCAG-AA contrast gate is unaffected. The
// hard ink edge (border-sidebar-edge) + shadow-sticker are the shared Pop-Art
// signature carried over from the rail.

import React from 'react';

type Accent = 'brand' | 'lime' | 'ok' | 'warn' | 'risk';

const ACCENT_BG: Record<Accent, string> = {
  brand: 'bg-brand',
  lime: 'bg-sidebar-active',
  ok: 'bg-ok',
  warn: 'bg-warn',
  risk: 'bg-risk',
};

export function PageHeader({
  title,
  kicker,
  accent = 'brand',
  action,
}: {
  title: string;
  kicker?: string;
  accent?: Accent;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="flex flex-col gap-2">
        {kicker && (
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-fg-muted">
            {kicker}
          </span>
        )}
        <div className="flex items-center gap-2.5">
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">{title}</h1>
          <span
            aria-hidden
            className={`size-3.5 shrink-0 -rotate-6 rounded-sm border-2 border-sidebar-edge shadow-sticker ${ACCENT_BG[accent]}`}
          />
        </div>
        <span aria-hidden className={`h-1.5 w-12 rounded-full ${ACCENT_BG[accent]}`} />
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export default PageHeader;
