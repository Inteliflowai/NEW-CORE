// src/app/(teacher)/challenges/_components/ChallengeCard.tsx
// Teacher-only row for one student's Spark Challenge. Restrained: status pill +
// transfer (word + %) + content_quality as a soft teacher label. Pop-Art chrome
// (hard ink edge + sticker shadow); status pill uses the WCAG-validated
// signal-surface/fg pairs. Tokens only; deep-ink text.
import React from 'react';
import type { ChallengeRow } from '@/lib/spark/loadChallenges';
import { transferWord } from '@/lib/spark/contract';

const STATUS_LABEL: Record<ChallengeRow['status'], string> = {
  assigned: 'Assigned',
  in_progress: 'In progress',
  completed: 'Completed',
};

const STATUS_PILL: Record<ChallengeRow['status'], string> = {
  assigned: 'bg-brand-surface text-brand-fg',
  in_progress: 'bg-warn-surface text-warn-fg',
  completed: 'bg-ok-surface text-ok-fg',
};

const QUALITY_LABEL: Record<NonNullable<ChallengeRow['contentQuality']>, string> = {
  engaged: 'engaged deeply',
  minimal: 'engaged lightly',
  non_engaged: 'did not engage',
};

export function ChallengeCard({ row }: { row: ChallengeRow }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border-2 border-sidebar-edge bg-surface px-4 py-3 shadow-sticker">
      <div className="flex flex-col">
        <span className="text-fg text-sm font-semibold">{row.studentName}</span>
        <span className="text-fg text-xs">{row.title}</span>
      </div>
      <div className="flex items-center gap-3">
        {row.status === 'completed' && row.transferScore != null && (
          <span className="text-fg text-sm">
            Transfer: <span className="font-semibold">{transferWord(row.transferScore)}</span> ({row.transferScore}%)
          </span>
        )}
        {row.contentQuality && (
          <span className="text-fg-muted text-xs">{QUALITY_LABEL[row.contentQuality]}</span>
        )}
        <span
          className={`shrink-0 rounded-full border-2 border-sidebar-edge px-2.5 py-0.5 text-xs font-bold ${STATUS_PILL[row.status]}`}
        >
          {STATUS_LABEL[row.status]}
        </span>
      </div>
    </div>
  );
}

export default ChallengeCard;
