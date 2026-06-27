'use client';

/**
 * ChapterTestPlayer — 5-section timed chapter test runner.
 *
 * State machine: loading → taking → submitting → result
 * (also jumps loading → result when the server auto-forfeits an expired attempt)
 *
 * Architecture:
 * - On mount: POST /api/attempts/chapter-test/start.
 *   Success → enter `taking` state.
 *   `forfeited: true` response → jump straight to `result`.
 * - Wall-clock 44-min timer via ChapterTestTimer (server-stamped started_at).
 *   onTimeUp → handleSubmit({ forfeit_reason: 'time_up' }).
 * - Free section navigation via a tab bar (sections 1–5).
 * - Per-question response state keyed by question_id.
 * - Autosave: 2s debounce per question → POST save-response.
 * - beforeunload: sendBeacon any pending (unsaved) drafts.
 * - Submit: native confirm dialog → POST submit → result state.
 *
 * Four-audience: chapter tests are GRADED (summative). The total_grade
 * is shown on the result screen (same policy as homework).
 * No band/CL/risk labels appear in this component.
 *
 * Copy drafts: STRINGS-FOR-BARB.md §Chapter Eval
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChapterTestTimer } from './ChapterTestTimer';
import { SectionCard } from './SectionCard';
import type { SectionData } from './SectionCard';
import { QuestionRenderer } from './QuestionRenderer';
import type { QuestionData, ResponseDraft } from './QuestionRenderer';
import { ChapterTestResultScreen } from './ChapterTestResultScreen';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChapterTestPlayerProps {
  chapterTestId: string;
  userId: string;
}

/** All valid player states. 'ready' is included for forward compat. */
export type PlayerState = 'loading' | 'ready' | 'taking' | 'submitting' | 'result';

interface SectionFromApi extends SectionData {
  questions: QuestionData[];
}

interface ExistingResponse {
  question_id: string;
  response_text: string | null;
  response_payload: Record<string, unknown>;
}

interface StartData {
  attemptId: string;
  startedAt: string;
  sections: SectionFromApi[];
  existing_responses: ExistingResponse[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TOTAL_MINUTES = 44;
const AUTOSAVE_DEBOUNCE_MS = 2000;

// ── Component ─────────────────────────────────────────────────────────────────

export function ChapterTestPlayer({
  chapterTestId,
  userId: _userId,
}: ChapterTestPlayerProps) {
  const [playerState, setPlayerState] = useState<PlayerState>('loading');
  const [startData, setStartData] = useState<StartData | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [activeSectionIdx, setActiveSectionIdx] = useState(0);
  const [responses, setResponses] = useState<Record<string, ResponseDraft>>({});
  const [showRecovery, setShowRecovery] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  /** questionId → pending setTimeout id */
  const autosaveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  // ── Cleanup: cancel all autosave timers on unmount ───────────────────────
  useEffect(() => {
    return () => {
      for (const timerId of autosaveTimers.current.values()) {
        clearTimeout(timerId);
      }
      autosaveTimers.current.clear();
    };
  }, []);

  // ── On mount: POST /start ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function startTest() {
      try {
        const res = await fetch('/api/attempts/chapter-test/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chapterTestId }),
        });

        if (!res.ok) {
          if (!cancelled)
            setStartError(
              'Unable to start your test. Please refresh and try again.',
            );
          return;
        }

        const data = (await res.json()) as {
          forfeited?: boolean;
          attempt_id: string;
          started_at?: string;
          sections?: SectionFromApi[];
          existing_responses?: ExistingResponse[];
        };
        if (cancelled) return;

        // Auto-forfeited (44 min already elapsed): jump straight to result
        if (data.forfeited === true) {
          setAttemptId(data.attempt_id);
          setPlayerState('result');
          return;
        }

        // Build initial response map from any saved responses (resume case)
        const existing = data.existing_responses ?? [];
        const initialResponses: Record<string, ResponseDraft> = {};
        for (const r of existing) {
          initialResponses[r.question_id] = {
            response_text: r.response_text ?? undefined,
            response_payload: r.response_payload ?? undefined,
          };
        }

        setAttemptId(data.attempt_id);
        setStartData({
          attemptId: data.attempt_id,
          startedAt: data.started_at!,
          sections: data.sections ?? [],
          existing_responses: existing,
        });
        setResponses(initialResponses);

        // Show recovery banner when student is resuming (had prior saves)
        if (existing.length > 0) {
          setShowRecovery(true);
        }

        setPlayerState('taking');
      } catch {
        if (!cancelled)
          setStartError(
            'Unable to start your test. Please refresh and try again.',
          );
      }
    }

    void startTest();
    return () => {
      cancelled = true;
    };
  }, [chapterTestId]);

  // ── beforeunload: flush pending unsaved drafts via sendBeacon ────────────
  useEffect(() => {
    if (playerState !== 'taking' || !attemptId) return;

    function handleBeforeUnload() {
      for (const [questionId, timerId] of autosaveTimers.current) {
        clearTimeout(timerId);
        const draft = responses[questionId];
        if (draft) {
          const payload = JSON.stringify({
            attemptId,
            questionId,
            response_text: draft.response_text ?? null,
            response_payload: draft.response_payload ?? {},
          });
          navigator.sendBeacon(
            '/api/attempts/chapter-test/save-response',
            new Blob([payload], { type: 'application/json' }),
          );
        }
      }
      autosaveTimers.current.clear();
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [playerState, attemptId, responses]);

  // ── Per-question autosave (2s debounce) ──────────────────────────────────
  const scheduleAutosave = useCallback(
    (questionId: string, draft: ResponseDraft) => {
      const existing = autosaveTimers.current.get(questionId);
      if (existing !== undefined) clearTimeout(existing);

      const timerId = setTimeout(() => {
        autosaveTimers.current.delete(questionId);
        if (!attemptId) return;
        void fetch('/api/attempts/chapter-test/save-response', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attemptId,
            questionId,
            response_text: draft.response_text ?? null,
            response_payload: draft.response_payload ?? {},
          }),
        });
      }, AUTOSAVE_DEBOUNCE_MS);

      autosaveTimers.current.set(questionId, timerId);
    },
    [attemptId],
  );

  const handleResponseChange = useCallback(
    (questionId: string, draft: ResponseDraft) => {
      setResponses((prev) => ({ ...prev, [questionId]: draft }));
      scheduleAutosave(questionId, draft);
    },
    [scheduleAutosave],
  );

  // ── Submit / forfeit ──────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (opts: { forfeit_reason?: string } = {}) => {
      if (!attemptId) return;

      // Cancel all pending autosave timers before submitting
      for (const timerId of autosaveTimers.current.values()) {
        clearTimeout(timerId);
      }
      autosaveTimers.current.clear();

      setPlayerState('submitting');

      try {
        const res = await fetch('/api/attempts/chapter-test/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attemptId,
            forfeit_reason: opts.forfeit_reason ?? null,
          }),
        });

        if (!res.ok) {
          // Non-fatal: let the student try again from the taking state
          console.error('[ChapterTestPlayer] submit failed, status:', res.status);
          setPlayerState('taking');
          return;
        }

        setPlayerState('result');
      } catch (err) {
        console.error('[ChapterTestPlayer] submit error (non-fatal):', err);
        setPlayerState('taking');
      }
    },
    [attemptId],
  );

  /** Called by ChapterTestTimer when elapsed ≥ 44 min. */
  const handleTimeUp = useCallback(() => {
    void handleSubmit({ forfeit_reason: 'time_up' });
  }, [handleSubmit]);

  /** Called by the "Submit test" button. Prompts confirmation first. */
  const handleSubmitClick = useCallback(() => {
    const confirmed = window.confirm(
      'Submit your test? You cannot make changes after submitting.',
    );
    if (confirmed) {
      void handleSubmit({});
    }
  }, [handleSubmit]);

  // ── Render ────────────────────────────────────────────────────────────────

  // loading (and start-error variant)
  if (playerState === 'loading') {
    if (startError !== null) {
      return (
        <div className="flex flex-col items-center justify-center py-20 gap-4 px-6 text-center">
          <p className="text-risk-fg text-sm">{startError}</p>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-fg-muted text-sm animate-pulse">Loading…</span>
      </div>
    );
  }

  // result
  if (playerState === 'result' && attemptId !== null) {
    return (
      <div className="min-h-screen bg-bg p-4">
        <ChapterTestResultScreen attemptId={attemptId} />
      </div>
    );
  }

  // submitting
  if (playerState === 'submitting') {
    return (
      <div
        role="status"
        className="fixed inset-0 bg-bg/90 flex flex-col items-center justify-center gap-4 z-50"
      >
        <span
          aria-hidden
          className="inline-block w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin"
        />
        <p className="font-display text-lg text-fg font-bold">Submitting…</p>
      </div>
    );
  }

  // taking (null guard: should not happen but keeps TS happy)
  if (playerState !== 'taking' || startData === null) return null;

  const { sections, startedAt } = startData;
  const activeSection = sections[activeSectionIdx];
  if (activeSection === undefined) return null;

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      {/* ── Top bar: timer + submit ── */}
      <div className="sticky top-0 z-10 bg-bg border-b-2 border-surface px-4 py-3 flex items-center justify-between gap-4 shadow-sticker">
        <ChapterTestTimer
          startedAt={startedAt}
          totalMinutes={TOTAL_MINUTES}
          onTimeUp={handleTimeUp}
        />

        <button
          type="button"
          onClick={handleSubmitClick}
          className="rounded-lg bg-brand text-fg-on-brand font-bold px-6 py-2 shadow-sticker hover:opacity-90"
        >
          Submit test
        </button>
      </div>

      {/* ── Recovery banner (shown when resuming a prior session) ── */}
      {showRecovery && (
        <div className="px-4 pt-3">
          <div className="rounded-lg bg-ok-surface border border-ok-fg/20 px-4 py-2 text-fg text-sm flex items-center justify-between gap-3">
            <span>Continuing your test — your progress has been saved.</span>
            <button
              type="button"
              onClick={() => setShowRecovery(false)}
              aria-label="Dismiss recovery banner"
              className="text-fg-muted text-xs hover:underline shrink-0"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ── Section tab bar ── */}
      <div
        className="px-4 pt-4 pb-1 flex gap-2 overflow-x-auto"
        role="tablist"
        aria-label="Test sections"
      >
        {sections.map((section, idx) => (
          <button
            key={section.id}
            type="button"
            role="tab"
            aria-selected={idx === activeSectionIdx}
            aria-label={section.title}
            onClick={() => setActiveSectionIdx(idx)}
            className={[
              'shrink-0 rounded-lg px-4 py-2 text-sm font-semibold border-2 transition-colors',
              idx === activeSectionIdx
                ? 'bg-brand text-fg-on-brand border-brand shadow-sticker'
                : 'bg-surface text-fg border-surface hover:border-brand',
            ].join(' ')}
          >
            {idx + 1}. {section.title}
          </button>
        ))}
      </div>

      {/* ── Active section content ── */}
      <div className="flex-1 px-4 py-6 max-w-3xl mx-auto w-full flex flex-col gap-6">
        <SectionCard section={activeSection} isActive>
          {activeSection.questions.map((question) => (
            <QuestionRenderer
              key={question.id}
              question={question}
              response={responses[question.id] ?? {}}
              onChange={(draft) => handleResponseChange(question.id, draft)}
            />
          ))}
        </SectionCard>
      </div>
    </div>
  );
}
