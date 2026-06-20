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
      <div className="mb-3 flex items-center gap-2">
        <span
          aria-hidden
          className="size-3 shrink-0 -rotate-6 rounded-sm border-2 border-sidebar-edge bg-brand"
        />
        <h2 className="font-display text-lg font-bold text-fg">Quick start</h2>
      </div>
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
