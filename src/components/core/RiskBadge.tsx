// src/components/core/RiskBadge.tsx
// TEACHER/ADMIN-ONLY component. Do NOT import on student or parent surfaces.
// Renders a risk score as a BANDED label pill — NEVER the raw numeric score.
// SCOPE §16 / spec §4: the band label carries the meaning; the number is suppressed.
// All colors reference Tier-2 semantic tokens only (no hardcoded hex, no color-name literals).
'use client';

import React from 'react';
import { riskBandLabel, type RiskBand } from '@/lib/copy/riskBandLabel';

export interface RiskBadgeProps {
  score: number;
  scale?: '0to1' | '0to100';
}

// Band → Tailwind utility classes using Tier-2 CSS token references only (C3).
// low → --ok (calm green), medium → --warn (amber), high/critical → --risk (coral).
const BAND_STYLES: Record<RiskBand, string> = {
  low:      'bg-ok      text-fg-on-brand',
  medium:   'bg-warn    text-fg-on-brand',
  high:     'bg-risk    text-fg-on-brand',
  critical: 'bg-risk    text-fg-on-brand ring-2 ring-risk',
};

/**
 * Pill badge that displays a risk band label for teacher/admin triage surfaces.
 * Renders ONLY the band string ('low' | 'medium' | 'high' | 'critical').
 * The raw numeric score is NEVER rendered and NEVER placed in a data attribute.
 */
export function RiskBadge({ score, scale = '0to100' }: RiskBadgeProps) {
  const band = riskBandLabel(score, scale);

  return (
    <span
      role="status"
      aria-label={`Risk level: ${band}`}
      className={[
        'inline-flex items-center rounded px-2.5 py-0.5 text-sm font-medium',
        BAND_STYLES[band],
      ].join(' ')}
    >
      {band}
    </span>
  );
}

export default RiskBadge;
