// src/app/(teacher)/insights/_components/ClassComprehensionTrend.tsx
// Over-time class comprehension. Soft direction sentence + the shared sparkline SHAPE.
// Point tooltips show the WEEK, never a raw %. Quiet until there's a real direction (≥3 weeks),
// so we never show a silent 2-dot graph. DRAFT → Barb.
import React from 'react';
import { Card } from '@/components/core/Card';
import { SectionLabel } from '../../_components/SectionLabel';
import { GradeTrendSparkline } from '@/components/core/GradeTrendSparkline';
import type { ClassComprehension } from '@/lib/insights/loadClassComprehension';

const DIRECTION_LINE: Record<'climbing' | 'steady' | 'sliding', string> = {
  climbing: 'Comprehension here has been climbing the last few weeks.',
  steady: 'Comprehension here has been holding steady.',
  sliding: 'Comprehension here has slipped a little lately — worth a look.',
};

export function ClassComprehensionTrend({
  trend,
}: { trend: ClassComprehension['trend'] }): React.JSX.Element | null {
  // Quiet until there's a real story (direction is null below 3 weeks).
  if (!trend.direction || trend.points.length < 2) return null;
  const line = DIRECTION_LINE[trend.direction];
  // grade carries the index for the line SHAPE; label is the week, so no % is ever printed.
  const points = trend.points.map((p) => ({ date: p.date, grade: p.index, label: `Week of ${p.date}` }));
  return (
    <Card tone="surface">
      <div className="flex flex-col gap-3">
        <SectionLabel tone="brand">Over time</SectionLabel>
        <p className="text-fg text-sm">{line}</p>
        <GradeTrendSparkline points={points} ariaLabel={line} size="md" />
      </div>
    </Card>
  );
}
export default ClassComprehensionTrend;
