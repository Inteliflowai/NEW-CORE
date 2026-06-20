// src/app/(teacher)/roster/_components/ActionChip.tsx
// Server component — no 'use client'.
// Renders a teacher-triage action chip from a SuggestedAction value.
// Tone → token class mapping enforces Tier-2 only (no hardcoded hex).

import React from 'react';
import type { SuggestedAction } from '@/lib/copy/diagnosisToFeedSentence';
import { actionChipLabel } from '@/lib/copy/actionChipLabel';
import type { ChipTone } from '@/lib/copy/actionChipLabel';

const TONE_CLASSES: Record<ChipTone, string> = {
  risk:  'bg-risk-surface text-risk-fg',
  warn:  'bg-warn-surface text-warn-fg',
  brand: 'bg-brand-surface text-brand-fg',
};

export function ActionChip({ action }: { action: SuggestedAction }): React.JSX.Element {
  const { label, tone } = actionChipLabel(action);
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}>
      {label}
    </span>
  );
}

export default ActionChip;
