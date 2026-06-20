// src/app/(teacher)/today/_components/QuickStartCard.tsx
// Server component — no 'use client'.
// Three teacher action links for the daily glance.
// All links carry ?class= param where relevant.

import React from 'react';
import { Card } from '@/components/core/Card';

interface QuickStartCardProps {
  classId: string;
}

export function QuickStartCard({ classId }: QuickStartCardProps): React.JSX.Element {
  return (
    <Card tone="brand">
      <h2 className="mb-3">
        <span className="inline-flex items-center rounded-md border-2 border-sidebar-edge bg-brand px-2.5 py-1 font-display text-sm font-extrabold uppercase tracking-wide text-fg-on-brand shadow-sticker">
          Quick start
        </span>
      </h2>
      <ul className="flex flex-col gap-2">
        <li>
          <a
            href={`/roster?class=${classId}`}
            className="flex items-center justify-between gap-2 rounded-lg border-2 border-sidebar-edge bg-surface px-3 py-2 text-sm font-semibold text-fg transition-colors hover:bg-brand hover:text-fg-on-brand"
          >
            Review your roster <span aria-hidden>›</span>
          </a>
        </li>
        <li>
          <a
            href="/upload"
            className="flex items-center justify-between gap-2 rounded-lg border-2 border-sidebar-edge bg-surface px-3 py-2 text-sm font-semibold text-fg transition-colors hover:bg-brand hover:text-fg-on-brand"
          >
            Start a lesson <span aria-hidden>›</span>
          </a>
        </li>
        <li>
          <a
            href={`/gradebook?class=${classId}`}
            className="flex items-center justify-between gap-2 rounded-lg border-2 border-sidebar-edge bg-surface px-3 py-2 text-sm font-semibold text-fg transition-colors hover:bg-brand hover:text-fg-on-brand"
          >
            Open the gradebook <span aria-hidden>›</span>
          </a>
        </li>
      </ul>
    </Card>
  );
}

export default QuickStartCard;
