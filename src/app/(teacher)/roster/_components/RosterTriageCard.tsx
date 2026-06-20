// src/app/(teacher)/roster/_components/RosterTriageCard.tsx
// Server component — no 'use client'.
// Teacher-only triage card for a single student in the focus group.
// NEVER renders r.risk.risk_score — only r.risk.risk_level is passed to RiskBadge.
// Tier-2 token classes only (no hardcoded hex, no arbitrary values).

import React from 'react';
import Link from 'next/link';
import type { FocusGroupItem, RosterItem } from '@/lib/signals/loadRosterSignals';
import { MasteryLabel } from '@/components/core/MasteryLabel';
import { RiskBadge } from '@/components/core/RiskBadge';
import { ActionChip } from './ActionChip';
import { riskFactorPhrase } from '@/lib/copy/riskFactorPhrase';
import { triageWhySentence } from '@/lib/copy/triageWhySentence';

// Left accent bar colour by severity
const ACCENT_BY_SEVERITY: Record<1 | 2 | 3, string> = {
  3: 'bg-risk',
  2: 'bg-warn',
  1: 'bg-brand',
};

// Dot-count display by severity
const DOTS_BY_SEVERITY: Record<1 | 2 | 3, string> = {
  3: '●●●',
  2: '●●',
  1: '●',
};

interface RosterTriageCardProps {
  item: FocusGroupItem;
  rosterById: Record<string, RosterItem>;
  classId: string;
}

export function RosterTriageCard({
  item,
  rosterById,
  classId,
}: RosterTriageCardProps): React.JSX.Element {
  const r = rosterById[item.student_id];
  const severity = item.diagnosis.severity as 1 | 2 | 3;
  const accentClass = ACCENT_BY_SEVERITY[severity];
  const dots = DOTS_BY_SEVERITY[severity];
  const lookCloserHref = `/students/${item.student_id}?from=roster&class=${classId}`;

  return (
    <div className="flex overflow-hidden rounded border border-surface">
      {/* Left accent bar */}
      <div className={`w-1 shrink-0 ${accentClass}`} aria-hidden="true" />

      {/* Card body */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        {/* Header row: dot-count + name + action chip */}
        <div className="flex items-center gap-2">
          <span
            className="text-xs tabular-nums"
            aria-label={`severity ${severity} of 3`}
          >
            {dots}
          </span>
          <span className="text-fg font-medium flex-1">{item.full_name}</span>
          <ActionChip action={item.diagnosis.suggestedAction} />
        </div>

        {/* Humanized "why" (teacher-only; keeps the numbers, explains the divergence,
            says "Assignment" not "HW" — never renders the raw diagnose() string). */}
        <p className="text-fg text-sm">
          {triageWhySentence({
            suggestedAction: item.diagnosis.suggestedAction,
            divergence_score: item.divergence_score,
            hw_avg: item.hw_avg,
            quiz_avg: item.quiz_avg,
          })}
        </p>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {r && <MasteryLabel band={r.band} />}
          {r && r.risk.risk_level !== 'low' && <RiskBadge band={r.risk.risk_level as 'medium' | 'high' | 'critical'} />}
          {r?.volatile && (
            <span className="text-warn-fg">∿ moving around lately</span>
          )}
          {r && r.risk.risk_factors.length > 0 && (
            <span className="text-fg-muted">△ {riskFactorPhrase(r.risk.risk_factors[0])}</span>
          )}
          <Link
            href={lookCloserHref}
            className="ml-auto text-brand-fg underline"
          >
            look closer ›
          </Link>
        </div>
      </div>
    </div>
  );
}

export default RosterTriageCard;
