// src/lib/copy/divergencePhrase.ts
//
// Teacher-facing "a pattern worth knowing" sentence for the assignment↔quiz
// divergence block on the One-Student screen.
//
// TEACHER-ONLY: intentionally carries the assignment + quiz averages (like
// triageWhySentence). Never forward to a student/parent surface. No assertNoLeak
// here — the numbers are by design. Says "Assignment", never "HW"/"Homework".

import type { DivergenceResult } from '@/lib/signals/computeHwQuizDivergence';

export type DivergenceInput = DivergenceResult & { divergence_flagged: boolean };

export function divergencePhrase(d: DivergenceInput): string {
  const gap = Math.round(d.divergence_score);
  const asg = d.hw_avg != null ? Math.round(d.hw_avg) : null;
  const quiz = d.quiz_avg != null ? Math.round(d.quiz_avg) : null;

  const trendClause =
    d.divergence_trend === 'widening'
      ? ' The gap has been widening.'
      : d.divergence_trend === 'narrowing'
        ? ' The gap has been narrowing.'
        : '';

  if (d.divergence_direction === 'hw_higher') {
    // Assignment work outpaces quizzes → the work may be propped up (help, redo, time).
    const lead =
      asg != null && quiz != null
        ? `Assignment scores (${asg}%) are running about ${gap} points above quiz scores (${quiz}%).`
        : `Assignment scores are running well above quiz scores.`;
    return `${lead} The work looks stronger than the quizzes — worth checking whether the assignment results hold up unaided.${trendClause}`;
  }

  if (d.divergence_direction === 'quiz_higher') {
    // Quizzes outpace assignment work → they may know more than the assignments show.
    const lead =
      asg != null && quiz != null
        ? `Quiz scores (${quiz}%) are running about ${gap} points above assignment scores (${asg}%).`
        : `Quiz scores are running well above assignment scores.`;
    return `${lead} They may understand more than the assignment work shows.${trendClause}`;
  }

  // aligned
  return `Assignment and quiz scores track closely together — no notable split.${trendClause}`;
}
