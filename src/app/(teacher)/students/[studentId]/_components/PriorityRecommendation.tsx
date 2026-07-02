// src/app/(teacher)/students/[studentId]/_components/PriorityRecommendation.tsx
// TEACHER-ONLY. Renders the ONE deterministic priority recommendation as a
// suggestion (text + the relevant in-page anchor / Gradebook link). The WRITE
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
  return (
    <div className="rounded-lg border-2 border-sidebar-edge bg-brand-surface p-3 shadow-sticker">
      <p className="text-brand-fg text-xs font-bold uppercase tracking-wide mb-1">
        Suggested next step
      </p>
      {/* "open-assignments" used to render as a non-navigating "Coming soon" label (no route existed); it now anchors to /gradebook, so it flows through this Link like every other kind. */}
      <Link href={cta.anchor ?? '#'} className="text-brand-fg font-bold underline">
        {cta.label} ›
      </Link>
    </div>
  );
}

export default PriorityRecommendation;
