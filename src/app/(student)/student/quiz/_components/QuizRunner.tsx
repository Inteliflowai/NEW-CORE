'use client';

/**
 * QuizRunner — the coached, timed student quiz runner.
 *
 * States: loading | no-quiz | ready | taking | submitting | grading-pending | done | forfeit
 *
 * Architecture:
 * - Wall-clock timer recomputed from server-stamped started_at every second
 *   (never a client countdown — honest across reloads)
 * - 15s heartbeat to /signal keeps last_active_at fresh
 * - Recovery banner on resuming_after_gap (30s–5min gap)
 * - Lazy-forfeit: HTTP 410 from /start → forfeit screen (no raw score)
 * - Adaptive Q4/Q5: POST /api/attempts/{id}/adapt after Q3
 * - Behavioral capture: inline useRef counters + global addEventListener
 *   listeners. No third-party library. Typed against SessionAggregates.
 * - All student strings assertNoLeak'd before render
 * - Option-D: no scorePct in client state; the server `result` bundle carries the
 *   coaching message + soft mastery label, rendered as a neutral pill
 *
 * Copy drafts: STRINGS-FOR-BARB.md §Quiz-Runner-Phase3
 * Grounding: docs/superpowers/plans/grounding/2026-06-21-quiz-runner-ui.md
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  classifyAttemptState,
  quizTimeRemainingSeconds,
  closureSecondsRemaining,
  QUIZ_DURATION_MINUTES,
} from '@/lib/student/quizAttemptState';
import type { SessionAggregates } from '@/lib/signals/behavioralTypes';
import { EmptyState } from '@/components/core/EmptyState';
import { Card } from '@/components/core/Card';
import { QuizTimer } from './QuizTimer';
import { QuestionCard } from './QuestionCard';
import type { QuizQuestion } from './QuestionCard';
import { ResultScreen } from './ResultScreen';
import type { QuestionReviewItem } from './ResultScreen';
import { RecoveryBanner } from './RecoveryBanner';
import type { StudentResultBundle } from '@/lib/quiz/studentResultBundle';

export interface QuizRunnerProps {
  userId: string;
  schoolId: string | null;
  tier: 'elementary' | 'middle' | 'high';
  firstName: string | null;
}

// ── Types matching Phase-2 API route responses (post-Task-2 shapes) ─────────

interface StudentQuizResponse {
  quiz: {
    id: string;
    title: string;
    quiz_questions: QuizQuestion[];
  } | null;
  existing_attempt: {
    id: string;
    is_complete: boolean;
    // Option-D: NO score_pct / mastery_band over the wire. A completed attempt
    // carries the pre-built bundle instead; in-progress attempts have no result.
    result?: StudentResultBundle;
    adapted_questions: unknown;
    started_at: string | null;
    last_active_at: string | null;
    forfeit_reason: string | null;
  } | null;
  teacher_name: string | null;
  class_name: string | null;
}

interface StartResponse {
  attempt_id: string;
  started_at?: string;
  state?: string;
  resumed_after_seconds?: number;
  closure_forfeit_minutes?: number;
  resume_banner_threshold_seconds?: number;
  forfeited?: boolean;
  forfeit_reason?: string;
}

interface SubmitResponse {
  attempt_id: string;
  raw_score?: number;
  // Option-D: the all-clean path returns the pre-built bundle, NOT score_pct/band.
  result?: StudentResultBundle;
  grades?: Array<{ position: number; score: number }>;
  grading_delayed?: boolean;
}

// review[] shape from POST /api/attempts/quiz-history (per-question, all positions)
interface QuizHistoryReviewRow {
  position: number;
  question_type: string;
  question_text: string;
  correct_answer: string | null;
  choices: unknown;
  rubric: string | null;
  student_answer: string;
  is_correct: boolean | null;
  ai_score: number | null;
  explanation: string;
}

// ── Runner state machine ───────────────────────────────────────────────────

type RunnerState =
  | 'loading'
  | 'no-quiz'
  | 'ready'
  | 'taking'
  | 'submitting'
  | 'grading-pending'
  | 'done'
  | 'forfeit';

const TOTAL_SECONDS = QUIZ_DURATION_MINUTES * 60;
const HEARTBEAT_INTERVAL_MS = 15_000;

// NOTE: tier + firstName are no longer consumed by the runner — the coaching
// message is built server-side (studentResultBundle) and arrives in the result
// bundle. They remain on the props for forward-compat (e.g. a future client-side
// greeting) but are underscore-prefixed so lint/tsc stay clean. The server
// wrapper still resolves them; keeping them on the contract is intentional.
export function QuizRunner({
  userId: _userId,
  schoolId: _schoolId,
  tier: _tier,
  firstName: _firstName,
}: QuizRunnerProps) {
  // ── Runner state ─────────────────────────────────────────────────────────
  const [runnerState, setRunnerState] = useState<RunnerState>('loading');
  const [quiz, setQuiz] = useState<StudentQuizResponse['quiz'] | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(TOTAL_SECONDS);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [responses, setResponses] = useState<Record<number, string>>({});  // position → response text
  const [showRecoveryBanner, setShowRecoveryBanner] = useState(false);
  const [gapSec, setGapSec] = useState(0);
  const [closureLeft, setClosureLeft] = useState(0);
  const [forfeitReason, setForfeitReason] = useState<'closure' | 'time_up' | undefined>();
  // Option-D: store the server-built bundle (no raw score in client state).
  const [resultBundle, setResultBundle] = useState<StudentResultBundle | null>(null);
  const [reviewItems, setReviewItems] = useState<QuestionReviewItem[]>([]);
  const [studyGuide, setStudyGuide] = useState<string | null>(null);
  const [studyGuideLoading, setStudyGuideLoading] = useState(false);
  const [adaptCalled, setAdaptCalled] = useState(false);

  // ── Behavioral capture refs ────────────────────────────────────────────
  // Per-question refs (reset on each advance/prev)
  const questionStartTime  = useRef<number>(Date.now());
  const firstInputTime     = useRef<number | null>(null);
  const answerChanges      = useRef<number>(0);
  const navigationBacks    = useRef<number>(0);
  const qPauseCount        = useRef<number>(0);
  const qTotalPauseMs      = useRef<number>(0);
  const qFocusLossCount    = useRef<number>(0);
  const qPasteCount        = useRef<number>(0);

  // Session-level refs (accumulate across all questions)
  const sessStartMs          = useRef<number>(Date.now());
  const sessFocusLossCount   = useRef<number>(0);
  const sessTotalFocusLossMs = useRef<number>(0);
  const sessPasteCount       = useRef<number>(0);
  const sessPauseCount       = useRef<number>(0);
  const sessTotalPauseMs     = useRef<number>(0);
  const sessBackspaceCount   = useRef<number>(0);
  const sessKeypressCount    = useRef<number>(0);
  const sessTtsPlayCount     = useRef<number>(0);
  const stuckEraseCount      = useRef<number>(0);

  // Pause detection state
  const lastKeypressMs    = useRef<number>(0);
  const pauseStartMs      = useRef<number | null>(null);
  const PAUSE_THRESHOLD   = 3000; // 3s gap between keypresses = pause

  // Focus-loss state
  const focusLostAt       = useRef<number | null>(null);

  // Auto-submit guard
  const autoSubmitTriggered = useRef(false);

  // ── Global behavioral listeners ────────────────────────────────────────
  useEffect(() => {
    // Only wire listeners when the quiz is in the taking state
    if (runnerState !== 'taking') return;

    // --- focus/visibility loss ---
    function handleVisibilityHidden() {
      if (document.hidden) {
        focusLostAt.current = Date.now();
        sessFocusLossCount.current += 1;
        qFocusLossCount.current += 1;
      } else if (focusLostAt.current !== null) {
        const elapsed = Date.now() - focusLostAt.current;
        sessTotalFocusLossMs.current += elapsed;
        focusLostAt.current = null;
      }
    }

    function handleBlur() {
      if (focusLostAt.current === null) {
        focusLostAt.current = Date.now();
        sessFocusLossCount.current += 1;
        qFocusLossCount.current += 1;
      }
    }

    function handleFocus() {
      if (focusLostAt.current !== null) {
        const elapsed = Date.now() - focusLostAt.current;
        sessTotalFocusLossMs.current += elapsed;
        focusLostAt.current = null;
      }
    }

    // --- paste ---
    function handlePaste() {
      sessPasteCount.current += 1;
      qPasteCount.current += 1;
    }

    // --- keydown (backspace + keypress + pause detection) ---
    function handleKeydown(e: KeyboardEvent) {
      const now = Date.now();

      // Pause detection: gap > 3s since last keypress
      if (lastKeypressMs.current > 0 && now - lastKeypressMs.current > PAUSE_THRESHOLD) {
        if (pauseStartMs.current === null) pauseStartMs.current = lastKeypressMs.current;
        // Pause ended on this keypress
        const pauseDur = now - pauseStartMs.current;
        sessPauseCount.current += 1;
        sessTotalPauseMs.current += pauseDur;
        qPauseCount.current += 1;
        qTotalPauseMs.current += pauseDur;

        // stuckEraseCount: pause > 3s immediately followed by Backspace
        if (e.key === 'Backspace' || e.key === 'Delete') {
          stuckEraseCount.current += 1;
        }

        pauseStartMs.current = null;
      }

      lastKeypressMs.current = now;

      if (e.key === 'Backspace' || e.key === 'Delete') {
        sessBackspaceCount.current += 1;
      }

      // Count printable keystrokes (single printable char + Enter + Space)
      if (e.key.length === 1 || e.key === 'Enter' || e.key === ' ') {
        sessKeypressCount.current += 1;
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityHidden);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('paste', handlePaste);
    document.addEventListener('keydown', handleKeydown);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityHidden);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('paste', handlePaste);
      document.removeEventListener('keydown', handleKeydown);
    };
  }, [runnerState]);

  // ── Helpers ────────────────────────────────────────────────────────────

  function buildSessionAggregates(): SessionAggregates {
    return {
      focusLossCount:    sessFocusLossCount.current,
      pasteCount:        sessPasteCount.current,
      pauseCount:        sessPauseCount.current,
      totalPauseMs:      sessTotalPauseMs.current,
      totalFocusLossMs:  sessTotalFocusLossMs.current,
      backspaceCount:    sessBackspaceCount.current,
      keypressCount:     sessKeypressCount.current,
      ttsPlayCount:      sessTtsPlayCount.current,
      canvasUsed:        false,
      stuckEraseCount:   stuckEraseCount.current,
    };
  }

  function snapshotPerQuestion(q: QuizQuestion, responseText: string) {
    const now = Date.now();
    const response_time_ms = now - questionStartTime.current;
    const hesitation_ms = firstInputTime.current !== null
      ? firstInputTime.current - questionStartTime.current
      : response_time_ms;
    const word_count = responseText.trim().split(/\s+/).filter(Boolean).length;
    return {
      question_id:          q.id,
      position:             q.position,
      response_text:        responseText,
      response_time_ms,
      hesitation_ms,
      answer_changes:       answerChanges.current,
      navigation_backs:     navigationBacks.current,
      pause_count:          qPauseCount.current,
      total_pause_ms:       qTotalPauseMs.current,
      word_count,
      focus_loss_count:     qFocusLossCount.current,
      paste_count:          qPasteCount.current,
      hints_used:           0,
      question_type_scored: q.question_type,
    };
  }

  function resetPerQuestionRefs() {
    questionStartTime.current = Date.now();
    firstInputTime.current    = null;
    answerChanges.current     = 0;
    navigationBacks.current   = 0;
    qPauseCount.current       = 0;
    qTotalPauseMs.current     = 0;
    qFocusLossCount.current   = 0;
    qPasteCount.current       = 0;
  }

  async function postSignal(
    id: string,
    responseItems: ReturnType<typeof snapshotPerQuestion>[],
    sessionAggregates?: SessionAggregates,
    heartbeat = false,
  ) {
    try {
      await fetch(`/api/attempts/${id}/signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responses: heartbeat ? [] : responseItems,
          sessionAggregates,
          heartbeat,
        }),
      });
    } catch {
      // Best-effort: never let signal failure break the runner
    }
  }

  // ── Load quiz on mount ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/attempts/student-quiz');
        if (!res.ok) { if (!cancelled) setRunnerState('no-quiz'); return; }
        const data: StudentQuizResponse = await res.json() as StudentQuizResponse;
        if (cancelled) return;

        if (!data.quiz) {
          setRunnerState('no-quiz');
          return;
        }

        setQuiz(data.quiz);

        const sortedQs = [...data.quiz.quiz_questions].sort((a, b) => a.position - b.position);
        setQuestions(sortedQs);

        // Pre-classify for ready/forfeit/resume states
        const existing = data.existing_attempt;
        if (existing) {
          const attemptState = classifyAttemptState({
            isComplete: existing.is_complete,
            forfeitReason: existing.forfeit_reason as 'closure' | 'time_up' | null,
            startedAt: existing.started_at,
            lastActiveAt: existing.last_active_at,
            now: new Date(),
          });

          if (attemptState === 'completed_normal') {
            // Quiz already done — show the done screen if the server attached a
            // result bundle (Option-D: no raw score reaches the client), else no-quiz.
            if (existing.result) {
              setResultBundle(existing.result);
              setRunnerState('done');
            } else {
              setRunnerState('no-quiz');
            }
            return;
          }

          if (attemptState === 'resuming_after_gap' && existing.last_active_at) {
            const gap = Math.floor((Date.now() - new Date(existing.last_active_at).getTime()) / 1000);
            const close = closureSecondsRemaining(existing.last_active_at, new Date());
            setGapSec(gap);
            setClosureLeft(close);
            setShowRecoveryBanner(true);
          }
        }

        setRunnerState('ready');
      } catch {
        setRunnerState('no-quiz');
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  // ── Start / resume quiz ────────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    if (!quiz) return;
    try {
      const res = await fetch('/api/attempts/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quiz_id: quiz.id }),
      });

      if (res.status === 410) {
        // Lazy-forfeit
        const data = await res.json() as StartResponse;
        setForfeitReason((data.forfeit_reason as 'closure' | 'time_up') ?? 'closure');
        setRunnerState('forfeit');
        return;
      }

      if (!res.ok) { setRunnerState('no-quiz'); return; }

      const data = await res.json() as StartResponse;
      setAttemptId(data.attempt_id);
      setStartedAt(data.started_at ?? null);
      sessStartMs.current = Date.now();
      questionStartTime.current = Date.now();
      setRunnerState('taking');
    } catch {
      setRunnerState('no-quiz');
    }
  }, [quiz]);

  // ── Wall-clock timer ───────────────────────────────────────────────────
  useEffect(() => {
    if (runnerState !== 'taking' || !startedAt) return;

    const tick = setInterval(() => {
      const remaining = quizTimeRemainingSeconds(startedAt, new Date());
      setTimeLeft(remaining);
    }, 1000);

    return () => clearInterval(tick);
  }, [runnerState, startedAt]);

  // ── Auto-submit at t=0 ────────────────────────────────────────────────
  useEffect(() => {
    if (timeLeft === 0 && runnerState === 'taking' && !autoSubmitTriggered.current) {
      autoSubmitTriggered.current = true;
      void handleSubmit();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, runnerState]);

  // ── 15s heartbeat ─────────────────────────────────────────────────────
  useEffect(() => {
    if (runnerState !== 'taking' || !attemptId) return;

    const hb = setInterval(() => {
      void postSignal(attemptId, [], undefined, true);
    }, HEARTBEAT_INTERVAL_MS);

    return () => clearInterval(hb);
  }, [runnerState, attemptId]);

  // ── Adaptive Q4/Q5 after Q3 ───────────────────────────────────────────
  useEffect(() => {
    if (
      runnerState === 'taking' &&
      attemptId &&
      currentIndex === 3 &&
      !adaptCalled
    ) {
      setAdaptCalled(true);
      void (async () => {
        try {
          // The /adapt route recomputes from Q1–Q3 responses server-side.
          const res = await fetch(`/api/attempts/${attemptId}/adapt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          if (!res.ok) return; // keep original Q4/Q5
          // Real route shape: { adapted: AdaptedQuestions }.
          // AdaptedQuestions = { level, mcq_pct, questions: [{ position, question_text,
          //   rubric, scaffold_hint, difficulty_label }] }. These are OPEN-response
          // Q4/Q5 ONLY — no question_type, no choices, no correct_answer.
          const data = await res.json() as {
            adapted?: {
              questions?: Array<{
                position: number;
                question_text: string;
                rubric?: string | null;
              }>;
            };
          };
          const adaptedEntries = data.adapted?.questions;
          if (!Array.isArray(adaptedEntries) || adaptedEntries.length === 0) return;

          // Map adapted entries → QuizQuestion (always question_type 'open'),
          // preserving each entry's position and reusing the original question id
          // where one exists at that position (else a synthetic id). Gated so a
          // malformed entry can never break rendering.
          setQuestions((prev) => {
            const byPosition = new Map(prev.map((q) => [q.position, q]));
            const mapped: QuizQuestion[] = adaptedEntries
              .filter((e) => typeof e?.position === 'number' && typeof e?.question_text === 'string')
              .map((e) => {
                const original = byPosition.get(e.position);
                return {
                  id: original?.id ?? `adapted-${e.position}`,
                  position: e.position,
                  question_type: 'open' as const,
                  question_text: e.question_text,
                  choices: null,
                  correct_answer: '',
                  rubric: e.rubric ?? null,
                  concept_tag: original?.concept_tag ?? null,
                  skill_id: original?.skill_id ?? null,
                };
              });
            if (mapped.length === 0) return prev; // nothing usable — keep originals
            // Splice mapped entries in at their positions; keep Q1–Q3 untouched.
            const base = prev.filter((q) => q.position <= 3);
            const adaptedByPos = new Map(mapped.map((q) => [q.position, q]));
            // Preserve original Q4/Q5 for any position the adapter didn't return.
            const tail = prev
              .filter((q) => q.position >= 4)
              .map((q) => adaptedByPos.get(q.position) ?? q);
            // Add any adapted positions not already present in the tail.
            for (const m of mapped) {
              if (!tail.some((q) => q.position === m.position)) tail.push(m);
            }
            tail.sort((a, b) => a.position - b.position);
            return [...base, ...tail];
          });
        } catch {
          // Graceful degradation — keep existing questions
        }
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, runnerState, attemptId, adaptCalled]);

  // ── Response handler ───────────────────────────────────────────────────
  function handleResponse(value: string) {
    const position = questions[currentIndex]?.position;
    if (position === undefined) return;
    if (responses[position] !== undefined && responses[position] !== value) {
      answerChanges.current += 1;
    }
    setResponses((prev) => ({ ...prev, [position]: value }));
  }

  function handleFirstInput() {
    if (firstInputTime.current === null) {
      firstInputTime.current = Date.now();
    }
  }

  // ── Navigation ─────────────────────────────────────────────────────────
  async function handleNext() {
    const q = questions[currentIndex];
    if (!q || !attemptId) return;
    const responseText = responses[q.position] ?? '';
    const snapshot = snapshotPerQuestion(q, responseText);

    // Post signal for this question
    await postSignal(attemptId, [snapshot]);
    resetPerQuestionRefs();
    setCurrentIndex((i) => i + 1);
  }

  async function handlePrev() {
    navigationBacks.current += 1;
    resetPerQuestionRefs();
    setCurrentIndex((i) => Math.max(0, i - 1));
  }

  // ── Submit ─────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!attemptId) return;
    setRunnerState('submitting');

    // Snapshot all remaining questions and post final signal + sessionAggregates
    // BEFORE calling submit — the grader reads quiz_responses.response_text.
    const allSnapshots = questions.map((q) => {
      const responseText = responses[q.position] ?? '';
      return snapshotPerQuestion(q, responseText);
    });
    await postSignal(attemptId, allSnapshots, buildSessionAggregates());

    // Grade
    try {
      const res = await fetch(`/api/attempts/${attemptId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quiz_attempt_id: attemptId }),
      });

      if (!res.ok) { setRunnerState('no-quiz'); return; }

      const data = await res.json() as SubmitResponse;

      if (data.grading_delayed) {
        setRunnerState('grading-pending');
        return;
      }

      // Store the server-built bundle (Option-D: no raw score in client state).
      const bundle = data.result ?? null;
      setResultBundle(bundle);

      // Build per-question review from the quiz-history POST — the authoritative
      // per-position correctness source. `submit`'s `grades[]` is OEQ-only
      // (positions 4–5), so deriving is_correct from it would mark every MCQ /
      // numeric question (positions 1–3) wrong. quiz-history returns every
      // position with is_correct, correct_answer, student_answer, explanation.
      try {
        const histRes = await fetch('/api/attempts/quiz-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attempt_id: attemptId }),
        });
        if (histRes.ok) {
          const histData = await histRes.json() as { review?: QuizHistoryReviewRow[] };
          const review = histData.review ?? [];
          const items: QuestionReviewItem[] = review.map((r) => ({
            position:      r.position,
            question_type: (r.question_type === 'mcq' || r.question_type === 'numeric')
              ? r.question_type
              : 'open',
            question_text: r.question_text,
            student_answer: r.student_answer ?? '',
            is_correct:    r.is_correct === true,
            correct_answer: r.correct_answer ?? '',
            explanation:   r.explanation || undefined,
          }));
          setReviewItems(items);
        }
      } catch {
        // Review is non-critical — done screen still renders without it.
      }

      setRunnerState('done');

      // Fetch study guide only when the server flagged it (needsStudyGuide).
      if (bundle?.needsStudyGuide) {
        setStudyGuideLoading(true);
        try {
          const sgRes = await fetch('/api/attempts/study-guide', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ quiz_attempt_id: attemptId }),
          });
          if (sgRes.ok) {
            const sgData = await sgRes.json() as { study_guide: string | null };
            setStudyGuide(sgData.study_guide ?? null);
          }
        } catch {
          // Graceful — study guide is non-critical
        } finally {
          setStudyGuideLoading(false);
        }
      }
    } catch {
      setRunnerState('no-quiz');
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  const currentQ = questions[currentIndex] ?? null;
  const currentResponse = currentQ ? (responses[currentQ.position] ?? '') : '';
  const isLastQ = currentIndex === questions.length - 1;
  const canGoNext = currentResponse !== '';

  // ── loading ──────────────────────────────────────────────────────────
  if (runnerState === 'loading') {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-fg-muted text-sm animate-pulse">Loading…</span>
      </div>
    );
  }

  // ── no-quiz ──────────────────────────────────────────────────────────
  if (runnerState === 'no-quiz') {
    return (
      <div className="p-6">
        <EmptyState
          variant="just-getting-started"
          titleOverride="No quiz right now"
          bodyOverride="Your teacher will let you know when a quiz is ready. Head to your assignments in the meantime."
        />
      </div>
    );
  }

  // ── done / forfeit / grading-pending ─────────────────────────────────
  if (
    runnerState === 'done' ||
    runnerState === 'forfeit' ||
    runnerState === 'grading-pending'
  ) {
    return (
      <div className="min-h-screen bg-bg p-4">
        <ResultScreen
          variant={runnerState}
          scoreMessage={resultBundle?.scoreMessage}
          masteryLabel={resultBundle?.masteryLabel ?? null}
          needsStudyGuide={resultBundle?.needsStudyGuide ?? false}
          reviewItems={reviewItems}
          studyGuide={studyGuide}
          studyGuideLoading={studyGuideLoading}
          forfeitReason={forfeitReason}
          onBack={() => { window.location.href = '/student/dashboard'; }}
          onStartAssignment={
            runnerState === 'done'
              ? () => { window.location.href = '/student/assignments'; }
              : undefined
          }
        />
      </div>
    );
  }

  // ── ready ─────────────────────────────────────────────────────────────
  if (runnerState === 'ready') {
    return (
      <div className="min-h-screen bg-bg flex flex-col items-center justify-center p-6 gap-8">
        <Card tone="brand" className="max-w-sm w-full text-center flex flex-col gap-4 p-6">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-fg">Quiz</p>
          <h1 className="font-display text-xl text-fg font-bold">{quiz?.title ?? 'Your Quiz'}</h1>
          <p className="text-fg-muted text-sm">
            You have {QUIZ_DURATION_MINUTES} minutes. The timer starts when you hit Begin.
          </p>
          <button
            type="button"
            onClick={() => void handleStart()}
            className="rounded-lg bg-brand text-fg-on-brand font-bold px-8 py-3 shadow-sticker hover:opacity-90"
          >
            Begin quiz
          </button>
        </Card>
      </div>
    );
  }

  // ── submitting ────────────────────────────────────────────────────────
  if (runnerState === 'submitting') {
    return (
      <div className="fixed inset-0 bg-bg/90 flex flex-col items-center justify-center gap-4 z-50">
        <span aria-hidden className="text-5xl animate-pulse">⏰</span>
        <p className="font-display text-xl text-fg font-bold">Time&apos;s up</p>
        <p className="text-fg-muted text-sm">Submitting your answers…</p>
      </div>
    );
  }

  // ── taking ────────────────────────────────────────────────────────────
  if (runnerState !== 'taking' || !currentQ) return null;

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      {/* Top bar: timer + progress */}
      <div className="sticky top-0 z-10 bg-bg border-b-2 border-surface px-4 py-3 flex items-center justify-between gap-4 shadow-sticker">
        <div className="flex items-center gap-2 text-fg-muted text-sm font-medium">
          <span>Q{currentIndex + 1}</span>
          <span>/</span>
          <span>{questions.length}</span>
        </div>

        <QuizTimer timeLeft={timeLeft} totalSeconds={TOTAL_SECONDS} />

        {/* Progress dots */}
        <div className="flex gap-1.5 flex-wrap justify-end">
          {questions.map((q, i) => {
            const isActive   = i === currentIndex;
            const isAnswered = (responses[q.position] ?? '') !== '';
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => {
                  if (isAnswered || i <= currentIndex) setCurrentIndex(i);
                }}
                aria-label={`Question ${i + 1}`}
                aria-current={isActive ? 'true' : undefined}
                className={[
                  'h-2 rounded-full transition-all duration-150',
                  isActive   ? 'w-6 bg-brand'       :
                  isAnswered ? 'w-2 bg-ok'           :
                               'w-2 bg-surface border border-fg-muted',
                ].join(' ')}
              />
            );
          })}
        </div>
      </div>

      {/* Recovery banner */}
      {showRecoveryBanner && (
        <div className="px-4 pt-4">
          <RecoveryBanner
            gapSec={gapSec}
            closureSecondsLeft={closureLeft}
            onDismiss={() => setShowRecoveryBanner(false)}
          />
        </div>
      )}

      {/* Question area */}
      <div className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full flex flex-col gap-6">
        <QuestionCard
          question={currentQ}
          currentResponse={currentResponse}
          onResponse={handleResponse}
          onFirstInput={handleFirstInput}
        />
      </div>

      {/* Navigation */}
      <div className="sticky bottom-0 bg-bg border-t-2 border-surface px-4 py-3 flex items-center justify-between gap-3">
        {/* Prev */}
        {currentIndex > 0 ? (
          <button
            type="button"
            onClick={() => void handlePrev()}
            className="rounded-lg border-2 border-surface bg-surface text-fg font-semibold px-5 py-2 hover:border-brand"
          >
            ← Back
          </button>
        ) : (
          <div />
        )}

        {/* Next / Submit */}
        {isLastQ ? (
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canGoNext}
            className={[
              'rounded-lg font-bold px-8 py-2 shadow-sticker transition-opacity',
              canGoNext
                ? 'bg-brand text-fg-on-brand hover:opacity-90'
                : 'bg-surface text-fg-muted border-2 border-surface cursor-not-allowed',
            ].join(' ')}
          >
            Submit quiz
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleNext()}
            disabled={!canGoNext}
            className={[
              'rounded-lg font-bold px-8 py-2 shadow-sticker transition-opacity',
              canGoNext
                ? 'bg-brand text-fg-on-brand hover:opacity-90'
                : 'bg-surface text-fg-muted border-2 border-surface cursor-not-allowed',
            ].join(' ')}
          >
            Next →
          </button>
        )}
      </div>
    </div>
  );
}
