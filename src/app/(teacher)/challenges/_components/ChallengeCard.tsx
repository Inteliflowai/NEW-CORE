// src/app/(teacher)/challenges/_components/ChallengeCard.tsx
// Per-challenge detail row inside an expanded student group. Teacher-only: transfer + engagement +
// rubric + date for scored ones; soft state for the rest. The title is the hover-tooltip trigger
// (name + submission date), mirroring the gradebook cell. Tokens only; deep-ink text.
'use client';
import React, { useState } from 'react';
import type { ChallengeRow } from '@/lib/spark/loadChallenges';
import { transferWord, RUBRIC_LABEL } from '@/lib/spark/contract';
import { challengeTooltipLines, shortDate } from '@/lib/spark/groupChallenges';
import StudentWorkPanel from './StudentWorkPanel';

const STATE_GLYPH: Record<ChallengeRow['status'], string> = { completed: '✓', in_progress: '◷', assigned: '○' };
const QUALITY_LABEL: Record<NonNullable<ChallengeRow['contentQuality']>, string> = {
  engaged: 'engaged deeply', minimal: 'engaged lightly', non_engaged: 'did not engage',
};

function rubricParts(rubric: Record<string, number | null> | null): string[] {
  if (!rubric) return [];
  return Object.entries(rubric)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => `${RUBRIC_LABEL[k] ?? k} ${v}/4`);
}

export function ChallengeCard({
  row,
  onTip,
  onHideTip,
}: {
  row: ChallengeRow;
  onTip: (lines: string[], x: number, y: number) => void;
  onHideTip: () => void;
}): React.JSX.Element {
  const lines = challengeTooltipLines(row);
  const dateLabel = row.status === 'completed' && row.completedAt ? `Submitted ${shortDate(row.completedAt)}` : '';
  const effortBits: string[] = [];
  if (row.effortLabel) effortBits.push(row.effortLabel);
  if (row.revisionCount != null) effortBits.push(`${row.revisionCount} ${row.revisionCount === 1 ? 'revision' : 'revisions'}`);
  if (row.teliHintCount != null) effortBits.push(`${row.teliHintCount} ${row.teliHintCount === 1 ? 'hint' : 'hints'}`);
  const rubric = rubricParts(row.rubric);
  const [showWork, setShowWork] = useState(false);

  return (
    <div className="flex flex-col gap-1 rounded-md border-2 border-sidebar-edge bg-surface px-3 py-2">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-fg-muted">{STATE_GLYPH[row.status]}</span>
        <span
          tabIndex={0}
          aria-label={lines.join(', ')}
          className="rounded text-fg text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          onMouseEnter={(e) => onTip(lines, e.clientX, e.clientY)}
          onMouseLeave={onHideTip}
          onFocus={(e) => { const r = e.currentTarget.getBoundingClientRect(); onTip(lines, r.left + r.width / 2, r.top); }}
          onBlur={onHideTip}
          onKeyDown={(e) => { if (e.key === 'Escape') onHideTip(); }}
        >
          {row.title}
        </span>
      </div>
      {row.status === 'completed' ? (
        <div className="flex flex-col gap-0.5 pl-6 text-xs text-fg">
          <span>
            Transfer: <span className="font-semibold">{transferWord(row.transferScore)}</span>
            {row.transferScore != null && <> ({row.transferScore}%)</>}
            {row.contentQuality && <> · {QUALITY_LABEL[row.contentQuality]}</>}
            {dateLabel && <> · {dateLabel}</>}
          </span>
          {rubric.length > 0 && <span className="text-fg-muted">Rubric: {rubric.join(' · ')}</span>}
          {effortBits.length > 0 && <span className="text-fg-muted">{effortBits.join(' · ')}</span>}
        </div>
      ) : (
        <span className="pl-6 text-xs text-fg-muted">
          {row.status === 'in_progress' ? 'In progress — not submitted yet' : 'Not started yet'}
        </span>
      )}
      {row.status !== 'assigned' && (
        <>
          <button
            type="button"
            onClick={() => setShowWork((v) => !v)}
            aria-expanded={showWork}
            className="mt-1 text-xs font-semibold text-brand hover:underline"
          >
            {showWork ? 'Hide student’s work' : 'View student’s work'}
          </button>
          {showWork && <StudentWorkPanel assignmentId={row.assignmentId} />}
        </>
      )}
    </div>
  );
}

export default ChallengeCard;
