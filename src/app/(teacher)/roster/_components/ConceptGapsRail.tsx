// src/app/(teacher)/roster/_components/ConceptGapsRail.tsx
// Server component — no 'use client'.
// Displays class-wide concept gaps using soft words (never raw percentages or opaque skill IDs).
// CRITICAL LEAK RULES:
//   - gap.question_text must NEVER appear in the DOM (it is an opaque internal skill_id)
//   - gap.pct_incorrect must NEVER be rendered directly — use pctIncorrectToWords() only

import React from 'react';
import type { ConceptGapItem } from '@/lib/signals/loadRosterSignals';
import { pctIncorrectToWords } from '@/lib/copy/pctIncorrectToWords';
import { EmptyState } from '@/components/core/EmptyState';

export function ConceptGapsRail({ gaps }: { gaps: ConceptGapItem[] }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-fg font-display text-base font-semibold">
        The whole class is stuck on
      </h2>

      {gaps.length === 0 ? (
        <EmptyState
          variant="on-track"
          titleOverride="No class-wide gaps"
          bodyOverride="No single skill is tripping up the group right now."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {gaps.map((gap) => {
            const skillLabel = gap.skill_name ?? "a skill we're still naming";
            const frequencyWords = pctIncorrectToWords(gap.pct_incorrect);
            return (
              <li
                key={gap.question_index}
                className="flex items-center justify-between rounded bg-surface p-3 text-sm"
              >
                <span className="text-fg font-medium">{skillLabel}</span>
                <span className="text-fg-muted text-xs">{frequencyWords} got this wrong</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default ConceptGapsRail;
