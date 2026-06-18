// src/components/core/MasteryLabel.tsx
// Renders the mastery band as a soft-word calm pill.
// SCOPE §15: delegates ALL band→label mapping to masteryDisplayLabel;
// DO NOT reimplement the mapping here.
// Styling uses only Tier-2 token utilities (bg-surface text-fg border-fg-muted)
// via Tailwind utility classes in className — no hardcoded colors, no data-band leakage.
// Uniform calm treatment for ALL bands: same neutral pill for Building / On Track /
// Strong / Not yet assessed. The word carries the meaning; no traffic-light coloring.

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
 * No data-band attribute: the raw enum is never exposed to the DOM on student/parent surfaces.
 */
export function MasteryLabel({ band }: MasteryLabelProps) {
  const label = masteryDisplayLabel(band);

  return (
    <span className="mastery-label inline-flex items-center rounded px-2.5 py-0.5 text-sm font-medium bg-surface text-fg border border-fg-muted">
      {label}
    </span>
  );
}

export default MasteryLabel;
