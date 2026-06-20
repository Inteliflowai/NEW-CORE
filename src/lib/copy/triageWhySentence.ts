// src/lib/copy/triageWhySentence.ts
//
// Humanized, teacher-facing "why" sentence for a roster triage card.
//
// Replaces the raw diagnose() string, which dumps jargon ("divergence score 44")
// and uses "HW". This KEEPS the numbers (the teacher wants the data) but explains
// the divergence — the gap between Assignment and quiz performance — in plain
// language, says what a wide/narrow gap means, and uses "Assignment", never "HW".
//
// TEACHER-ONLY: contains raw scores by design; never forward to a student/parent
// surface (no assertNoLeak here — numbers are intentional).

import type { SuggestedAction } from '@/lib/copy/diagnosisToFeedSentence';

export interface TriageWhyInput {
  suggestedAction: SuggestedAction;
  divergence_score: number;
  hw_avg: number | null; // Assignment average
  quiz_avg: number | null;
}

export function triageWhySentence(d: TriageWhyInput): string {
  const gap = Math.round(d.divergence_score);
  const quiz = d.quiz_avg != null ? Math.round(d.quiz_avg) : null;
  const asg = d.hw_avg != null ? Math.round(d.hw_avg) : null;

  switch (d.suggestedAction) {
    case 'reteach':
      // Quiz low + wide assignment↔quiz split → the concept itself needs reteaching.
      return quiz != null
        ? `Quiz average is ${quiz}% and runs about ${gap} points below their assignment scores — when assignment and quiz results split this far apart and quizzes are this low, the concept itself usually needs another pass with the group.`
        : `Quizzes are coming in low and well under their assignment work — that wide a gap usually means the concept itself needs another pass with the group.`;
    case 'verbal_check':
      // Assignment low but quiz higher → they may know more than assignments show.
      return asg != null && quiz != null
        ? `Assignment average (${asg}%) is about ${gap} points below their quiz average (${quiz}%) — they're doing better on quizzes than on the assignments themselves, so they may understand more than the work shows. A quick verbal check confirms it before you act.`
        : `Their assignment scores trail their quizzes by a wide margin — they may understand more than the assignments show, so a quick verbal check confirms it.`;
    case 'practice':
      return `The same kind of mistake keeps recurring — some targeted practice on that skill should close it.`;
    case 'profile':
      // Generic divergence → assignment and quiz tell different stories; look closer.
      return `Their assignment and quiz scores diverge by about ${gap} points — noticeably stronger on one than the other, which is worth a closer look at what's going on for them.`;
    case 'monitor':
      return `A ${gap}-point gap between their assignment and quiz work — a small divergence for now, but worth keeping an eye on.`;
  }
}
