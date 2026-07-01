import React from 'react';
import { Card } from '@/components/core/Card';
import { GradeTrendSparkline } from '@/components/core/GradeTrendSparkline';
import { parentTrendLead, type TrendDirection } from '@/lib/copy/parentTrendCopy';
import type { ParentProgressPoint } from '@/lib/parent/loadParentProgress';
import { assertNoLeak, assertNoBannedWord } from '@/lib/copy/leakGuard';

export function TrendCard({
  direction,
  points,
}: {
  direction: TrendDirection;
  points: ParentProgressPoint[];
}): React.JSX.Element {
  const lead = parentTrendLead(direction);
  // Belt-and-suspenders: name-free composed prose must never leak.
  assertNoLeak(lead, 'TrendCard/lead');
  assertNoBannedWord(lead, 'TrendCard/lead');

  return (
    <Card>
      <div className="flex flex-col gap-2">
        <p className="text-fg text-xs font-bold uppercase tracking-wide">Grades over time</p>
        {/* Gate the lead on a real direction so it never contradicts the sparkline's
            own cold-start. `direction` is null for <3 graded attempts; the sparkline
            cold-start fires at <2 points — showing parentTrendLead(null) alongside a
            drawn 2-point line (or duplicating the cold-start copy) would read wrong.
            Mirrors the shipped student growth page (gate on gradeDirection !== null). */}
        {direction !== null && <p className="text-fg text-base leading-relaxed">{lead}</p>}
        <GradeTrendSparkline
          points={points}
          ariaLabel="How grades have moved over time"
          coldStartLabel="We are still building a learning history — keep checking back."
        />
      </div>
    </Card>
  );
}

export default TrendCard;
