// src/components/core/MasteryLabel.tsx
// Renders the mastery band as a soft-word pill.
// SCOPE §15: delegates ALL band→label mapping to masteryDisplayLabel;
// DO NOT reimplement the mapping here.
// Colors reference only Tier-2 CSS vars (--brand, --ok, --warn, --risk, --surface).

import { masteryDisplayLabel } from '@/lib/utils/masteryLabel';

interface MasteryLabelProps {
  /** Raw DB mastery_band enum value, or null for "not yet assessed". */
  band: string | null;
}

/**
 * Pill component that renders the human-readable mastery label.
 * 'reteach' → 'Building' | 'grade_level' → 'On Track' | 'advanced' → 'Strong' | null → 'Not yet assessed'
 *
 * Single-sourced via masteryDisplayLabel — never re-implements the band mapping.
 * Safe for student/parent/teacher surfaces (unlike CL/RiskBadge which are teacher-only).
 */
export function MasteryLabel({ band }: MasteryLabelProps) {
  const label = masteryDisplayLabel(band);

  return (
    <span className="mastery-label" data-band={band ?? 'none'}>
      {label}
    </span>
  );
}

export default MasteryLabel;
