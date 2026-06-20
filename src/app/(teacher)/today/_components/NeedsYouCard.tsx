// src/app/(teacher)/today/_components/NeedsYouCard.tsx
// Server component — no 'use client'.
// Shows the top-3 focus-group students with action chips and humanized why sentences.
// TEACHER-ONLY: triageWhySentence contains scores by design.
// Leak discipline: never renders risk_score or diagnosis.diagnosis.

import React from 'react';
import { Card } from '@/components/core/Card';
import { ActionChip } from '@/app/(teacher)/roster/_components/ActionChip';
import { triageWhySentence } from '@/lib/copy/triageWhySentence';
import type { FocusGroupItem } from '@/lib/signals/loadRosterSignals';

interface NeedsYouCardProps {
  /** Already sorted by sortFocusGroup (severity DESC, action priority ASC, name ASC) */
  focusGroup: FocusGroupItem[];
  classId: string;
}

export function NeedsYouCard({ focusGroup, classId }: NeedsYouCardProps): React.JSX.Element {
  if (focusGroup.length === 0) {
    return (
      <Card>
        <div className="mb-3 flex items-center gap-2">
        <span
          aria-hidden
          className="size-3 shrink-0 -rotate-6 rounded-sm border-2 border-sidebar-edge bg-warn"
        />
        <h2 className="font-display text-lg font-bold text-fg">Needs you</h2>
      </div>
        <p className="text-fg-muted text-sm">
          Nothing urgent today — everyone&apos;s tracking along.
        </p>
      </Card>
    );
  }

  const top3 = focusGroup.slice(0, 3);

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <span
          aria-hidden
          className="size-3 shrink-0 -rotate-6 rounded-sm border-2 border-sidebar-edge bg-warn"
        />
        <h2 className="font-display text-lg font-bold text-fg">Needs you</h2>
      </div>
      <ul className="flex flex-col gap-4">
        {top3.map((item) => {
          const whySentence = triageWhySentence({
            suggestedAction: item.diagnosis.suggestedAction,
            divergence_score: item.divergence_score,
            hw_avg: item.hw_avg,
            quiz_avg: item.quiz_avg,
          });
          return (
            <li key={item.student_id} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-fg font-medium text-sm">{item.full_name}</span>
                <ActionChip action={item.diagnosis.suggestedAction} />
              </div>
              <p className="text-fg-muted text-sm">{whySentence}</p>
            </li>
          );
        })}
      </ul>
      <a
        href={`/roster?class=${classId}`}
        className="block mt-4 text-brand text-sm hover:underline"
      >
        See the full roster ›
      </a>
    </Card>
  );
}

export default NeedsYouCard;
