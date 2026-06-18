// src/components/core/CLBadge.tsx
// TEACHER-SURFACE-ONLY component. Do NOT import on student or parent surfaces.
// Renders the CL (comprehension-level) verb for a skill_learning_state, plus
// an optional soft-word confidence qualifier.
//
// RULES (spec §4 / SCOPE §16):
//   - Reuses CL_VERB_BY_STATE from @/lib/skills/clVerbs — no re-implementation.
//   - null verb (insufficient_data / not_attempted) → "Not yet assessed"
//   - confidence shown ONLY as soft words (consistent / tentative / emerging)
//     per brief bands: ≥70 → consistent, ≥40 → tentative, else → emerging
//   - raw 0–100 confidence number NEVER rendered and NEVER placed in a data attr
//   - all colors via Tier-2 CSS tokens only (no hardcoded hex, no color-name literals)
'use client';

import React from 'react';
import {
  CL_VERB_BY_STATE,
  type SkillLearningState,
} from '@/lib/skills/clVerbs';

export interface CLBadgeProps {
  /** The skill learning state from the DB enum. */
  state: SkillLearningState;
  /**
   * Confidence score (0–100). Rendered as a soft word only — the raw number
   * NEVER appears in the DOM. Pass null or omit to suppress confidence display.
   */
  confidence?: number | null;
}

type ConfidenceWord = 'consistent' | 'tentative' | 'emerging';

/** Maps a numeric confidence to a soft word. Raw number never exposed. */
function toConfidenceWord(confidence: number): ConfidenceWord {
  if (confidence >= 70) return 'consistent';
  if (confidence >= 40) return 'tentative';
  return 'emerging';
}

// Verb → Tailwind utility classes using Tier-2 token references only (C3).
// Reinforce        → warn-surface / warn-fg    (amber tinted pair, gate-enforced AA ≥ 4.5:1)
// On Track         → ok-surface / ok-fg        (emerald tinted pair, gate-enforced AA ≥ 4.5:1)
// Enrich           → brand-surface / brand-fg  (brand tinted pair, gate-enforced AA ≥ 4.5:1)
// Not yet assessed → neutral surface / fg-muted with token border
const VERB_STYLES: Record<string, string> = {
  Reinforce:          'bg-warn-surface  text-warn-fg',
  'On Track':         'bg-ok-surface    text-ok-fg',
  Enrich:             'bg-brand-surface text-brand-fg',
  'Not yet assessed': 'bg-surface       text-fg-muted ring-1 ring-inset ring-fg-muted',
};

/**
 * Pill badge that displays a CL verb for teacher/admin triage surfaces.
 * Renders the CL verb string or "Not yet assessed" — never the raw state enum.
 * Optionally renders a confidence soft word (consistent/tentative/emerging).
 * The raw confidence number is NEVER rendered and NEVER placed in a data attr.
 */
export function CLBadge({ state, confidence }: CLBadgeProps) {
  const verb = CL_VERB_BY_STATE[state];
  const label = verb ?? 'Not yet assessed';
  const styleClass = VERB_STYLES[label] ?? VERB_STYLES['Not yet assessed'];

  // Only show confidence word when we have an active verb + a numeric confidence
  const word: ConfidenceWord | null =
    verb !== null && typeof confidence === 'number' && confidence !== null
      ? toConfidenceWord(confidence)
      : null;

  return (
    <span
      role="status"
      aria-label={word ? `${label}, ${word}` : label}
      className={[
        'inline-flex items-center rounded px-2.5 py-0.5 text-sm font-medium',
        styleClass,
      ].join(' ')}
    >
      {label}
      {word && (
        <span className="ml-1 opacity-80 font-normal">
          {word}
        </span>
      )}
    </span>
  );
}

export default CLBadge;
