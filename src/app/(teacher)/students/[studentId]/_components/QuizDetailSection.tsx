// src/app/(teacher)/students/[studentId]/_components/QuizDetailSection.tsx
// TEACHER-ONLY. Displays the student's most-recent quiz attempts with per-question
// breakdown (student answer vs correct answer for MCQ, AI score for OEQ).
// Tokens only; content text-fg.
import React from 'react';
import { SectionLabel } from '../../../_components/SectionLabel';
import type { QuizAttemptDetail } from '@/lib/signals/loadStudentQuizDetails';

function bandLabel(band: string | null): string {
  if (band === 'reteach') return 'Reinforce';
  if (band === 'grade_level') return 'On Track';
  if (band === 'advanced') return 'Enrich';
  return '—';
}

function lsLabel(ls: string | null): string | null {
  if (!ls) return null;
  const MAP: Record<string, string> = {
    visual: 'Visual',
    auditory: 'Auditory',
    reading_writing: 'Reading/writing',
    kinesthetic: 'Kinesthetic',
  };
  return MAP[ls] ?? null;
}

function aiScoreLabel(score: number | null): string {
  if (score === 1) return 'Correct';
  if (score === 0.5) return 'Partial';
  if (score === 0) return 'Incorrect';
  return '—';
}

interface Props {
  attempts: QuizAttemptDetail[];
}

export function QuizDetailSection({ attempts }: Props): React.JSX.Element | null {
  if (attempts.length === 0) return null;

  return (
    <section className="flex flex-col gap-2.5" aria-label="Quiz performance">
      <h2><SectionLabel tone="brand">Quiz performance</SectionLabel></h2>
      <div className="flex flex-col gap-4">
        {attempts.map((a) => (
          <div
            key={a.attemptId}
            className="rounded-lg border-2 border-sidebar-edge bg-surface p-3 flex flex-col gap-3"
          >
            {/* Header row — quiz title + score + band + LS */}
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <p className="font-bold text-fg text-sm">{a.quizTitle ?? 'Quiz'}</p>
              <span className="text-xs text-fg-muted">
                {a.scorePct != null ? `${Math.round(a.scorePct)}%` : '—'}
                {' · '}
                {bandLabel(a.masteryBand)}
                {a.learningStyle && lsLabel(a.learningStyle)
                  ? ` · ${lsLabel(a.learningStyle)}`
                  : ''}
              </span>
            </div>

            {/* Per-question rows */}
            {a.responses.length > 0 && (
              <ul className="flex flex-col gap-2.5">
                {a.responses.map((r, i) => (
                  <li key={i} className="text-sm text-fg flex flex-col gap-1">
                    <p className="font-medium leading-snug">{r.questionText}</p>
                    {r.questionType === 'mcq' ? (
                      <div className="text-xs text-fg-muted flex flex-wrap gap-x-3 gap-y-0.5">
                        <span>Student: <strong className="text-fg">{r.studentAnswer ?? '—'}</strong></span>
                        <span>Correct: <strong className="text-fg">{r.correctAnswer ?? '—'}</strong></span>
                        {r.isCorrect != null && (
                          <span className={r.isCorrect ? 'text-ok font-bold' : 'text-warn font-bold'}>
                            {r.isCorrect ? '✓' : '✗'}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-fg-muted flex flex-wrap gap-x-3 gap-y-0.5">
                        <span className="italic">
                          {r.studentAnswer ? `"${r.studentAnswer}"` : '(no response)'}
                        </span>
                        {r.aiScore != null && (
                          <span className={r.aiScore === 1 ? 'text-ok font-bold' : r.aiScore === 0.5 ? 'text-fg font-bold' : 'text-warn font-bold'}>
                            {aiScoreLabel(r.aiScore)}
                          </span>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default QuizDetailSection;
