'use client';

/**
 * ResultScreen — the post-submit screen family.
 *
 * variant='done':
 *   - Qualitative heading ("You finished the quiz! ✨")
 *   - Teli coaching message from the PRE-BUILT bundle (scoreMessage.teliMsg
 *     rendered as text; TTS call site deferred — see TODO(tts) below)
 *   - Neutral mastery pill from the soft `masteryLabel` (no color coding)
 *   - Per-question ✓/✗ review accordion (no numeric scores per question)
 *   - Study guide accordion (needsStudyGuide only)
 *   - "What happens next" section
 *
 * Option-D: this component NEVER receives a percentage or a raw band enum.
 * The coaching message + soft label are built server-side (studentResultBundle)
 * and passed in. There is no getScoreMessage call here.
 *
 * variant='forfeit':
 *   - Gentle copy; reason (closure vs time_up); NO raw score (Option-D)
 *   - assertNoLeak runs on all rendered strings
 *
 * variant='grading-pending':
 *   - Static "being graded" screen; Back CTA only
 *
 * ALL student-facing strings are passed through assertNoLeak (throws in
 * non-production, logs in production — safe boundary).
 * Copy drafts are in STRINGS-FOR-BARB.md §Quiz-Runner-Phase3.
 */

import React, { useState } from 'react';
import type { StudentResultBundle } from '@/lib/quiz/studentResultBundle';
import { assertNoLeak } from '@/lib/copy/leakGuard';

export interface QuestionReviewItem {
  position: number;
  question_type: 'mcq' | 'numeric' | 'open';
  question_text: string;
  student_answer: string;
  is_correct: boolean;
  correct_answer: string;
  explanation?: string;
}

export interface ResultScreenProps {
  variant: 'done' | 'forfeit' | 'grading-pending';
  // done — pre-built server bundle (Option-D: no scorePct, no raw band enum)
  scoreMessage?: StudentResultBundle['scoreMessage'];
  masteryLabel?: string | null;
  needsStudyGuide?: boolean;
  reviewItems?: QuestionReviewItem[];
  studyGuide?: string | null;
  studyGuideLoading?: boolean;
  // forfeit
  forfeitReason?: 'closure' | 'time_up';
  // shared
  onBack: () => void;
  onStartAssignment?: () => void;
}

/**
 * Escapes HTML entities first, then applies safe markdown transforms.
 * This prevents injected HTML tags (e.g. from prompt-injected LLM output)
 * from rendering as live DOM elements — XSS mitigation.
 */
function renderGuideHtml(guide: string): string {
  const escaped = guide
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br />');
}

function StudyGuideAccordion({
  loading,
  guide,
}: {
  loading?: boolean;
  guide?: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border-2 border-surface bg-surface shadow-sticker">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="font-semibold text-fg text-sm">📚 Revision notes</span>
        <span aria-hidden className="text-fg-muted text-sm">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 text-fg text-sm leading-relaxed border-t border-surface pt-3">
          {loading && <span className="text-fg-muted">Pulling together your revision notes…</span>}
          {!loading && !guide && (
            <span className="text-fg-muted">
              Notes aren&apos;t ready yet — come back after your next practice session.
            </span>
          )}
          {!loading && guide && (
            <div
              dangerouslySetInnerHTML={{
                __html: renderGuideHtml(guide),
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function QuestionReviewAccordion({ items }: { items: QuestionReviewItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border-2 border-surface bg-surface shadow-sticker">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="font-semibold text-fg text-sm">How did you do?</span>
        <span aria-hidden className="text-fg-muted text-sm">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <ul className="px-4 pb-4 border-t border-surface pt-3 flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.position} className="flex flex-col gap-1">
              <p className="text-fg text-sm leading-snug">{item.question_text}</p>
              {item.is_correct ? (
                <span className="text-ok font-semibold text-sm">Correct ✓</span>
              ) : (
                <>
                  <span className="text-warn-fg font-semibold text-sm">Let&apos;s look at this one</span>
                  {item.question_type !== 'open' && (
                    <p className="text-fg-muted text-xs">
                      Your answer: {item.student_answer || '—'}
                    </p>
                  )}
                  {item.explanation && (
                    <p className="text-fg-muted text-xs italic">{item.explanation}</p>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ResultScreen({
  variant,
  scoreMessage,
  masteryLabel,
  needsStudyGuide = false,
  reviewItems = [],
  studyGuide,
  studyGuideLoading,
  forfeitReason,
  onBack,
  onStartAssignment,
}: ResultScreenProps) {

  // ── grading-pending ────────────────────────────────────────────────────────
  if (variant === 'grading-pending') {
    return (
      <div className="flex flex-col items-center gap-6 py-12 px-6 text-center">
        <span aria-hidden className="text-5xl">⏳</span>
        <h1 className="font-display text-2xl text-fg font-bold">
          Your quiz is being graded
        </h1>
        <div className="rounded-lg border-2 border-warn bg-warn-surface px-5 py-4 max-w-sm text-left">
          <p className="text-fg text-sm leading-relaxed">
            Your written answers are being reviewed. Check back in a few minutes
            — we&apos;ll save everything.
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg bg-brand text-fg-on-brand font-semibold px-6 py-3 shadow-sticker hover:opacity-90"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  // ── forfeit ────────────────────────────────────────────────────────────────
  if (variant === 'forfeit') {
    const reasonCopy = forfeitReason === 'time_up'
      ? 'Time ran out before you finished.'
      : 'The quiz closed while you were away.';
    // assertNoLeak — these strings must be clear of numeric leaks
    assertNoLeak('Quiz Closed', 'ResultScreen/forfeit/eyebrow');
    assertNoLeak(reasonCopy, 'ResultScreen/forfeit/reason');
    return (
      <div className="flex flex-col items-center gap-6 py-12 px-6 text-center">
        <span aria-hidden className="text-5xl">⏸️</span>
        <div className="flex flex-col gap-2">
          <span className="uppercase text-xs font-bold tracking-widest text-warn-fg">
            Quiz Closed
          </span>
          <h1 className="font-display text-2xl text-fg font-bold">{reasonCopy}</h1>
          <p className="text-fg-muted text-sm leading-relaxed max-w-sm mx-auto">
            Your teacher can see your progress — this quiz will still shape what
            you work on next.
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg bg-brand text-fg-on-brand font-semibold px-6 py-3 shadow-sticker hover:opacity-90"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  // ── done ───────────────────────────────────────────────────────────────────
  // Option-D: no scorePct, no raw band. The coaching message + soft label are
  // pre-built server-side (studentResultBundle) and passed in as props.
  const msg = scoreMessage ?? { message: '', teliMsg: '', teliState: 'idle' as const };
  // TODO(tts): wire teliSpeak(msg.teliMsg) here once a V2 TTS call site is confirmed
  // in src/components/. Until then teliMsg renders as static text.

  // assertNoLeak on all rendered copy strings (belt-and-suspenders; the server
  // helper already leak-guards, but the render boundary is the last line of defense).
  if (msg.message) assertNoLeak(msg.message, 'ResultScreen/done/message');
  if (msg.teliMsg) assertNoLeak(msg.teliMsg, 'ResultScreen/done/teliMsg');
  if (masteryLabel) assertNoLeak(masteryLabel, 'ResultScreen/done/masteryLabel');

  const showStudyGuide = needsStudyGuide;

  return (
    <div className="flex flex-col gap-6 py-8 px-4 max-w-xl mx-auto">
      {/* Heading */}
      <div className="text-center flex flex-col gap-3">
        <h1 className="font-display text-2xl text-fg font-bold">
          You finished the quiz! ✨
        </h1>
        {/* Coaching headline — distinct from the Teli card below */}
        {msg.message && (
          <p className="text-fg text-base leading-relaxed">{msg.message}</p>
        )}
      </div>

      {/* Teli coaching message */}
      {msg.teliMsg && (
        <div className="rounded-lg border-2 border-brand bg-brand-surface shadow-sticker px-5 py-4">
          <p className="text-brand-fg text-sm leading-relaxed italic">
            &ldquo;{msg.teliMsg}&rdquo;
          </p>
          <p className="text-brand-fg text-xs mt-1 font-semibold">— Teli</p>
        </div>
      )}

      {/* Mastery label — neutral pill, no color coding. The soft word is already
          built server-side (masteryDisplayLabel); render it directly in the same
          neutral token treatment MasteryLabel uses — no raw enum reaches the DOM. */}
      {masteryLabel && (
        <div className="flex justify-center">
          <span className="mastery-label inline-flex items-center rounded px-2.5 py-0.5 text-sm font-medium bg-surface text-fg border border-fg-muted">
            {masteryLabel}
          </span>
        </div>
      )}

      {/* What happens next */}
      <div className="rounded-lg border-2 border-surface bg-surface shadow-sticker px-5 py-4 flex flex-col gap-2">
        <p className="text-fg font-semibold text-sm">What happens next</p>
        <p className="text-fg-muted text-sm leading-relaxed">
          ◆ A personalized set of practice questions is ready for you.
        </p>
      </div>

      {/* Per-question review */}
      {reviewItems.length > 0 && (
        <QuestionReviewAccordion items={reviewItems} />
      )}

      {/* Study guide (score < 80) OR strong performance copy */}
      {showStudyGuide ? (
        <StudyGuideAccordion loading={studyGuideLoading} guide={studyGuide} />
      ) : (
        <div className="rounded-lg border-2 border-ok bg-ok-surface px-5 py-4 shadow-sticker">
          <p className="text-ok-fg text-sm leading-relaxed">
            ✓ You got most of these right — solid work. Your next practice will push you further.
          </p>
        </div>
      )}

      {/* CTAs */}
      <div className="flex flex-col gap-3">
        {onStartAssignment && (
          <button
            type="button"
            onClick={onStartAssignment}
            className="rounded-lg bg-brand text-fg-on-brand font-semibold px-6 py-3 shadow-sticker hover:opacity-90 text-center"
          >
            Start assignment
          </button>
        )}
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border-2 border-surface bg-surface text-fg font-semibold px-6 py-3 hover:border-brand text-center"
        >
          Back to dashboard
        </button>
      </div>
    </div>
  );
}
