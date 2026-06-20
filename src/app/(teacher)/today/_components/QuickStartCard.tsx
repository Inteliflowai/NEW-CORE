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
    <Card>
      <h2 className="mb-3">
        <span className="inline-flex items-center rounded-md border-2 border-sidebar-edge bg-brand-surface px-2.5 py-1 font-display text-sm font-extrabold uppercase tracking-wide text-brand-fg shadow-sticker">
          Quick start
        </span>
      </h2>
      <ul className="flex flex-col gap-3">
        <li>
          <a
            href={`/roster?class=${classId}`}
            className="text-brand hover:underline block text-sm"
          >
            Review your roster
          </a>
        </li>
        <li>
          <a
            href="/upload"
            className="text-brand hover:underline block text-sm"
          >
            Start a lesson
          </a>
        </li>
        <li>
          <a
            href={`/gradebook?class=${classId}`}
            className="text-brand hover:underline block text-sm"
          >
            Open the gradebook
          </a>
        </li>
      </ul>
    </Card>
  );
}

export default QuickStartCard;
