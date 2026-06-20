// src/app/(teacher)/challenges/_components/ChallengeCard.tsx
// Teacher-only row for one student's Spark Challenge. Restrained: status + transfer (word + %)
// + content_quality as a soft teacher label. Tokens only; deep-ink text.
import React from 'react';
import type { ChallengeRow } from '@/lib/spark/loadChallenges';
import { transferWord } from '@/lib/spark/contract';

const STATUS_LABEL: Record<ChallengeRow['status'], string> = {
  assigned: 'Assigned',
  in_progress: 'In progress',
  completed: 'Completed',
};

const QUALITY_LABEL: Record<NonNullable<ChallengeRow['contentQuality']>, string> = {
  engaged: 'engaged deeply',
  minimal: 'engaged lightly',
  non_engaged: 'did not engage',
};

export function ChallengeCard({ row }: { row: ChallengeRow }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 rounded border border-surface bg-surface px-4 py-3">
      <div className="flex flex-col">
        <span className="text-fg text-sm font-semibold">{row.studentName}</span>
        <span className="text-fg text-xs">{row.title}</span>
      </div>
      <div className="flex items-center gap-4">
        {row.status === 'completed' && row.transferScore != null ? (
          <span className="text-fg text-sm">
            Transfer: <span className="font-semibold">{transferWord(row.transferScore)}</span> ({row.transferScore}%)
          </span>
        ) : (
          <span className="text-fg text-sm">{STATUS_LABEL[row.status]}</span>
        )}
        {row.contentQuality && (
          <span className="text-fg text-xs">{QUALITY_LABEL[row.contentQuality]}</span>
        )}
      </div>
    </div>
  );
}

export default ChallengeCard;
