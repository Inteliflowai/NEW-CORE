// src/app/(teacher)/insights/_components/HowClassLearns.tsx
// The class learning-style reassurance line. Teacher-only; never per-student. Quiet unless
// there's a confident mix. Copy: "differentiate", never "adapt". DRAFT → Barb.
import React from 'react';
import { Card } from '@/components/core/Card';
import { SectionLabel } from '../../_components/SectionLabel';
import type { ClassLearningStyle } from '@/lib/insights/loadClassLearningStyle';

export function HowClassLearns({
  learningStyle,
}: { learningStyle: ClassLearningStyle }): React.JSX.Element | null {
  if (!learningStyle.line) return null; // quiet when not a confident mix
  return (
    <Card tone="surface">
      <div className="flex flex-col gap-2">
        <SectionLabel tone="ok">How your class learns</SectionLabel>
        <p className="text-fg text-sm">{learningStyle.line}</p>
      </div>
    </Card>
  );
}
export default HowClassLearns;
