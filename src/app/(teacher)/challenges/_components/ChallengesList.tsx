// src/app/(teacher)/challenges/_components/ChallengesList.tsx
// Client: expandable student groups (one row per student) + a single fixed-position tooltip
// (the gradebook pattern). Teacher-only surface.
'use client';
import React, { useState } from 'react';
import type { StudentChallengeGroup } from '@/lib/spark/groupChallenges';
import { studentSummaryLabel } from '@/lib/spark/groupChallenges';
import { ChallengeCard } from './ChallengeCard';

export function ChallengesList({ groups }: { groups: StudentChallengeGroup[] }): React.JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tip, setTip] = useState<{ lines: string[]; x: number; y: number } | null>(null);

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="flex flex-col gap-2">
      {groups.map((g) => {
        const open = expanded.has(g.studentId);
        return (
          <div key={g.studentId} className="rounded-lg border-2 border-sidebar-edge bg-surface shadow-sticker">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => toggle(g.studentId)}
              className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className="text-fg-muted">{open ? '▾' : '▸'}</span>
                <span className="text-fg text-sm font-semibold">{g.studentName}</span>
              </span>
              <span className="text-fg-muted text-xs">{studentSummaryLabel(g.summary)}</span>
            </button>
            {open && (
              <div className="flex flex-col gap-2 px-4 pb-3">
                {g.challenges.map((c) => (
                  <ChallengeCard
                    key={c.assignmentId}
                    row={c}
                    onTip={(lines, x, y) => setTip({ lines, x, y })}
                    onHideTip={() => setTip(null)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-40 max-w-xs -translate-x-1/2 -translate-y-full rounded-md border-2 border-sidebar-edge bg-surface px-2 py-1 text-xs text-fg shadow-sticker"
          style={{ left: tip.x, top: tip.y - 6 }}
        >
          {tip.lines.map((l, i) => (
            <div key={i} className={i === 0 ? 'font-bold' : ''}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ChallengesList;
