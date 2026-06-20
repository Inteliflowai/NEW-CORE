// src/app/(teacher)/students/[studentId]/_components/PriorityRecommendation.tsx
// TEACHER-ONLY. Renders the ONE deterministic priority recommendation as a
// suggestion (text + the relevant in-page anchor / Assignments link). The WRITE
// (flag-for-reteach, leave-note, high-five) is DEFERRED — this is read-only scope.
// Tokens only.

import React from 'react';
import Link from 'next/link';
import type { PriorityCta } from '../_lib/priorityCta';

interface PriorityRecommendationProps {
  cta: PriorityCta;
}

export function PriorityRecommendation({
  cta,
}: PriorityRecommendationProps): React.JSX.Element {
  // Non-anchor "open-assignments" fallback has no teacher route yet, so it renders
  // as a non-navigating label rather than a dead link that 404s on prefetch.
  const isOpenAssignments = cta.kind === 'open-assignments';

  return (
    <div className="rounded-lg border-2 border-sidebar-edge bg-brand-surface p-3 shadow-sticker">
      <p className="text-brand-fg text-xs font-bold uppercase tracking-wide mb-1">
        Suggested next step
      </p>
      {isOpenAssignments ? (
        <span className="text-brand-fg font-bold" title="Coming soon">
          {cta.label} ›
        </span>
      ) : (
        <Link href={cta.anchor ?? '#'} className="text-brand-fg font-bold underline">
          {cta.label} ›
        </Link>
      )}
    </div>
  );
}

export default PriorityRecommendation;
