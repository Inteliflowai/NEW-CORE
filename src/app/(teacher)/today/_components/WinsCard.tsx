// src/app/(teacher)/today/_components/WinsCard.tsx
// Server component — no 'use client'.
// Shows advanced-band students and the on-track count.
// Four-audience discipline: growth is "you vs your own past" (GrowthMotif cold-start is correct here).
// Token-only styling — no hardcoded hex.

import React from 'react';
import { Card } from '@/components/core/Card';
import { GrowthMotif } from '@/components/core/GrowthMotif';
import type { RosterItem } from '@/lib/signals/loadRosterSignals';

interface WinsCardProps {
  roster: RosterItem[]; // students NOT in the focus group (caller filters)
}

export function WinsCard({ roster }: WinsCardProps): React.JSX.Element {
  const strongStudents = roster.filter((r) => r.band === 'advanced');
  // "on track or stronger" = all assessed students (band is not null)
  const onTrackCount = roster.filter((r) => r.band !== null).length;
  const studentWord = onTrackCount === 1 ? 'student' : 'students';

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <span
          aria-hidden
          className="size-3 shrink-0 -rotate-6 rounded-sm border-2 border-sidebar-edge bg-ok"
        />
        <h2 className="font-display text-lg font-bold text-fg">Wins</h2>
      </div>
      {strongStudents.length === 0 ? (
        <p className="text-fg-muted text-sm mb-3">
          Everyone&apos;s still building — keep at it.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 mb-3">
          {strongStudents.map((s) => (
            <li key={s.student_id} className="text-fg font-medium text-sm">
              {s.full_name}
            </li>
          ))}
        </ul>
      )}
      <p className="text-fg-muted text-sm">
        {onTrackCount} {studentWord} are on track or stronger
      </p>
      <div className="mt-4">
        {/* No growth_history at class level → renders cold-start state, which is correct */}
        <GrowthMotif accent="ok" />
      </div>
    </Card>
  );
}

export default WinsCard;
