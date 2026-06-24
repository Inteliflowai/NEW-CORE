// src/lib/copy/actionChipLabel.ts
// Maps a SuggestedAction to a label + tone for roster chip display.
// Pure function — no side effects, no leakage needed (labels are static teacher copy).

import type { SuggestedAction } from '@/lib/copy/diagnosisToFeedSentence';

export type ChipTone = 'risk' | 'warn' | 'brand';

export interface ActionChip {
  label: string;
  tone: ChipTone;
}

/**
 * Maps a suggestedAction to a user-facing label + semantic tone.
 * Used to render action chips in the roster and focus-group UI.
 */
export function actionChipLabel(action: SuggestedAction): ActionChip {
  switch (action) {
    case 'reteach':
      // User-facing wording is the softer "reinforce" (Marvin, 2026-06-24); the
      // 'reteach' enum value stays as the internal key.
      return { label: 'reinforce now', tone: 'risk' };
    case 'verbal_check':
      return { label: 'check in', tone: 'warn' };
    case 'practice':
      return { label: 'practice', tone: 'warn' };
    case 'profile':
      return { label: 'look closer', tone: 'brand' };
    case 'monitor':
      return { label: 'watch', tone: 'brand' };
  }
}
