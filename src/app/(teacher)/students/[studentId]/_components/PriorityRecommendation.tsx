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
  assignmentsHref: string;
}

export function PriorityRecommendation({
  cta,
  assignmentsHref,
}: PriorityRecommendationProps): React.JSX.Element {
  const href = cta.kind === 'open-assignments' ? assignmentsHref : (cta.anchor ?? '#');

  return (
    <div className="rounded border border-brand-fg bg-brand-surface p-3">
      <p className="text-brand-fg text-xs font-medium uppercase tracking-wide mb-1">
        Suggested next step
      </p>
      <Link href={href} className="text-brand-fg font-medium underline">
        {cta.label} ›
      </Link>
    </div>
  );
}

export default PriorityRecommendation;
