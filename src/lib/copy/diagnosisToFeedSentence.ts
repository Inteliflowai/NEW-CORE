// src/lib/copy/diagnosisToFeedSentence.ts
// Maps a structured DiagnoseResult (suggestedAction + severity) to a
// leak-free audience-safe feed sentence for teacher/admin surfaces.
// Pure + import-safe (no Next.js / Supabase imports).

import { assertNoLeak } from './leakGuard';

/** The five suggestedAction values from DiagnoseResult. */
export type SuggestedAction =
  | 'reteach'
  | 'practice'
  | 'verbal_check'
  | 'profile'
  | 'monitor';

export interface DiagnosisInput {
  suggestedAction: SuggestedAction;
  severity: 1 | 2 | 3;
}

const ACTION_SENTENCES: Record<SuggestedAction, string> = {
  reteach:
    'This concept looks like it needs another pass with the group.',
  practice:
    'Targeted practice on this skill should help.',
  verbal_check:
    'Strong on practice but the quiz didn\'t match — worth a quick verbal check.',
  profile:
    'Worth a quick look at what\'s going on for this student.',
  monitor:
    'A small gap worth keeping an eye on.',
};

/**
 * Returns a leak-free feed sentence for a structured diagnosis result.
 *
 * Takes the STRUCTURED fields ({ suggestedAction, severity }), NOT the raw
 * `diagnosis` string, so it never inherits numeric leaks from diagnose().
 */
export function diagnosisToFeedSentence(d: DiagnosisInput): string {
  const sentence = ACTION_SENTENCES[d.suggestedAction];
  assertNoLeak(sentence, 'diagnosisToFeedSentence');
  return sentence;
}
