'use client';

/**
 * AssignmentPlayer — the coached, UNTIMED non-SPARK assignment player.
 *
 * States: read | tasks | submitting | graded | pending | error
 *
 * Architecture (reuses the Epic-1 quiz-runner spine, see QuizRunner.tsx):
 * - Two-phase flow: a Read phase (title / instructions / passage) → a working
 *   Tasks phase (one typed open-response per task). UNTIMED — no timer/forfeit
 *   (deliberately not ported from the quiz runner).
 * - Behavioral capture: inline useRef counters + global addEventListener
 *   listeners (focusLoss / paste / pause / backspace / keypress / stuckErase),
 *   PAUSE_THRESHOLD = 3000ms. ttsPlayCount / canvasUsed stay 0/false (Segments
 *   4/5). Typed against SessionAggregates.
 * - Autosave: a debounced (3s) PUT /api/attempts/homework-draft writes the
 *   canonical responses jsonb; a localStorage mirror lets a fresh mount restore
 *   a newer in-flight draft (network-loss resilience).
 * - Submit: POST /api/attempts/homework-submit { attempt_id, responses,
 *   sessionAggregates, perTaskMetrics }. Assignments are GRADED → the result
 *   bundle carries the visible grade (AssignmentResultScreen renders it). A
 *   `grading_delayed` response routes to the pending screen (never-half-grade).
 *
 * Copy drafts: STRINGS-FOR-BARB.md §Assignment-Player.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { SessionAggregates } from '@/lib/signals/behavioralTypes';
import type { AssignmentContent, ResponsesShape } from '@/lib/assignments/loadAssignmentForPlay';
import type { AssignmentResultBundle } from '@/lib/assignments/assignmentResultBundle';
import { ReadPhase } from './ReadPhase';
import { TaskCard } from './TaskCard';
import { TeliPanel } from './TeliPanel';
import { TaskRail } from './TaskRail';
import { SubmitPanel } from './SubmitPanel';
import { AssignmentResultScreen } from './AssignmentResultScreen';
import { SubmittingScreen, PendingScreen, ErrorScreen } from './StateScreens';

export interface AssignmentPlayerProps {
  assignmentId: string;
  attemptId: string;
  content: AssignmentContent;
  initialResponses: ResponsesShape;
}

type PlayerState = 'read' | 'tasks' | 'submitting' | 'graded' | 'pending' | 'error';

type PerTaskMetric = { step: number; timeTakenMs: number; changeCount: number };

interface SubmitResponse {
  attempt_id: string;
  result?: AssignmentResultBundle;
  grading_delayed?: boolean;
  message?: string;
}

const PAUSE_THRESHOLD = 3000; // 3s gap between keypresses = a pause
const AUTOSAVE_DEBOUNCE_MS = 3000;
const draftKey = (attemptId: string) => `core:assignment-draft:${attemptId}`;

function textFor(responses: ResponsesShape, step: number): string {
  return responses.tasks[String(step)]?.text ?? '';
}

function imageFor(responses: ResponsesShape, step: number): string | null {
  return responses.tasks[String(step)]?.image_url ?? null;
}

function hasAnswer(responses: ResponsesShape, step: number): boolean {
  return textFor(responses, step).trim() !== '' || imageFor(responses, step) != null;
}

export function AssignmentPlayer({ assignmentId: _assignmentId, attemptId, content, initialResponses }: AssignmentPlayerProps) {
  const tasks = content.tasks ?? [];

  // ── Player state ─────────────────────────────────────────────────────────
  const [state, setState] = useState<PlayerState>('read');
  // Lazy initialiser: prefer a newer localStorage draft over the server-provided
  // initialResponses. The mirror is written on every keystroke-debounce, so it is
  // always at least as fresh. Resolving this at mount (not via an effect+setState)
  // keeps the first render correct and avoids a cascading render.
  const [responses, setResponses] = useState<ResponsesShape>(() => {
    const fallback = initialResponses ?? { tasks: {} };
    if (typeof window === 'undefined') return fallback;
    try {
      const raw = window.localStorage.getItem(draftKey(attemptId));
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as { responses?: ResponsesShape; savedAt?: number };
      if (parsed?.responses?.tasks) return parsed.responses;
    } catch {
      // Corrupt/absent draft — ignore; server initialResponses stand.
    }
    return fallback;
  });
  const [currentIndex, setCurrentIndex] = useState(0);
  const [result, setResult] = useState<AssignmentResultBundle | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | undefined>();

  // ── Behavioral capture refs (mirror QuizRunner) ──────────────────────────
  // Timers are lazily initialised (0 → stamped in handleStart) so render stays
  // pure — Date.now() is never called during render (react-hooks/purity).
  const sessStartMs        = useRef<number>(0);
  const sessFocusLossCount = useRef<number>(0);
  const sessTotalFocusLossMs = useRef<number>(0);
  const sessPasteCount     = useRef<number>(0);
  const sessPauseCount     = useRef<number>(0);
  const sessTotalPauseMs   = useRef<number>(0);
  const sessBackspaceCount = useRef<number>(0);
  const sessKeypressCount  = useRef<number>(0);
  const stuckEraseCount    = useRef<number>(0);

  const canvasUsedRef      = useRef(false);
  const sessTtsPlayCount   = useRef<number>(0);

  const lastKeypressMs = useRef<number>(0);
  const pauseStartMs   = useRef<number | null>(null);
  const focusLostAt    = useRef<number | null>(null);

  // Per-task metrics — taskStartTime is stamped in handleStart before the tasks
  // phase opens, so a 0 placeholder never reaches a read (keeps render pure).
  const taskStartTime  = useRef<number>(0);
  const changeCounts   = useRef<Record<number, number>>({});
  const taskTimeMs     = useRef<Record<number, number>>({});

  // Autosave bookkeeping
  const autosaveTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const responsesRef   = useRef<ResponsesShape>(responses);

  // Mirror the latest responses into a ref for event handlers (handleTaskChange /
  // handleSubmit) — synced in an effect so render never writes to a ref.
  useEffect(() => {
    responsesRef.current = responses;
  }, [responses]);

  // ── Global behavioral listeners (only while working through tasks) ────────
  useEffect(() => {
    if (state !== 'tasks') return;

    function handleVisibility() {
      if (document.hidden) {
        focusLostAt.current = Date.now();
        sessFocusLossCount.current += 1;
      } else if (focusLostAt.current !== null) {
        sessTotalFocusLossMs.current += Date.now() - focusLostAt.current;
        focusLostAt.current = null;
      }
    }
    function handleBlur() {
      if (focusLostAt.current === null) {
        focusLostAt.current = Date.now();
        sessFocusLossCount.current += 1;
      }
    }
    function handleFocus() {
      if (focusLostAt.current !== null) {
        sessTotalFocusLossMs.current += Date.now() - focusLostAt.current;
        focusLostAt.current = null;
      }
    }
    function handlePaste(e: ClipboardEvent) {
      // Ignore pastes into the Teli tutor chat — they are not work on the assignment
      // and must not pollute the behavioral aggregates (signal hygiene).
      if ((e.target as HTMLElement | null)?.closest?.('[data-testid="teli-panel"]')) return;
      sessPasteCount.current += 1;
    }
    function handleKeydown(e: KeyboardEvent) {
      // Ignore keystrokes into the Teli tutor chat — same signal-hygiene reason as paste.
      if ((e.target as HTMLElement | null)?.closest?.('[data-testid="teli-panel"]')) return;
      const now = Date.now();
      if (lastKeypressMs.current > 0 && now - lastKeypressMs.current > PAUSE_THRESHOLD) {
        if (pauseStartMs.current === null) pauseStartMs.current = lastKeypressMs.current;
        const pauseDur = now - pauseStartMs.current;
        sessPauseCount.current += 1;
        sessTotalPauseMs.current += pauseDur;
        if (e.key === 'Backspace' || e.key === 'Delete') stuckEraseCount.current += 1;
        pauseStartMs.current = null;
      }
      lastKeypressMs.current = now;
      if (e.key === 'Backspace' || e.key === 'Delete') sessBackspaceCount.current += 1;
      if (e.key.length === 1 || e.key === 'Enter' || e.key === ' ') sessKeypressCount.current += 1;
    }

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('paste', handlePaste);
    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('paste', handlePaste);
      document.removeEventListener('keydown', handleKeydown);
    };
  }, [state]);

  // ── Helpers ──────────────────────────────────────────────────────────────
  function buildSessionAggregates(): SessionAggregates {
    return {
      focusLossCount:   sessFocusLossCount.current,
      pasteCount:       sessPasteCount.current,
      pauseCount:       sessPauseCount.current,
      totalPauseMs:     sessTotalPauseMs.current,
      totalFocusLossMs: sessTotalFocusLossMs.current,
      backspaceCount:   sessBackspaceCount.current,
      keypressCount:    sessKeypressCount.current,
      ttsPlayCount:     sessTtsPlayCount.current,
      canvasUsed:       canvasUsedRef.current,    // flipped when the student draws (Seg 5)
      stuckEraseCount:  stuckEraseCount.current,
    };
  }

  function buildPerTaskMetrics(): PerTaskMetric[] {
    // Fold in the time spent on the currently-open task before snapshotting.
    const now = Date.now();
    const liveStep = tasks[currentIndex]?.step;
    if (typeof liveStep === 'number') {
      taskTimeMs.current[liveStep] = (taskTimeMs.current[liveStep] ?? 0) + (now - taskStartTime.current);
      taskStartTime.current = now;
    }
    return tasks.map((t) => ({
      step: t.step,
      timeTakenMs: taskTimeMs.current[t.step] ?? 0,
      changeCount: changeCounts.current[t.step] ?? 0,
    }));
  }

  // ── Autosave (debounced PUT + localStorage mirror) ───────────────────────
  const persistDraftNow = useCallback((next: ResponsesShape) => {
    try {
      window.localStorage.setItem(draftKey(attemptId), JSON.stringify({ responses: next, savedAt: Date.now() }));
    } catch { /* best-effort */ }
    void fetch('/api/attempts/homework-draft', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ attempt_id: attemptId, responses: next }),
    }).catch(() => {});
  }, [attemptId]);

  const scheduleAutosave = useCallback((next: ResponsesShape) => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      // localStorage mirror first (synchronous, survives a network drop).
      try {
        window.localStorage.setItem(draftKey(attemptId), JSON.stringify({ responses: next, savedAt: Date.now() }));
      } catch {
        // storage full / unavailable — best-effort
      }
      void fetch('/api/attempts/homework-draft', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attempt_id: attemptId, responses: next }),
      }).catch(() => { /* best-effort autosave */ });
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [attemptId]);

  // Flush any pending autosave on unmount — fire immediately if a timer is pending.
  useEffect(() => () => {
    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
      persistDraftNow(responsesRef.current);
    }
  }, [persistDraftNow]);

  // ── Response handler ───────────────────────────────────────────────────
  function handleTaskChange(step: number, value: string) {
    const prevText = textFor(responsesRef.current, step);
    if (prevText !== '' && prevText !== value) {
      changeCounts.current[step] = (changeCounts.current[step] ?? 0) + 1;
    }
    setResponses((prev) => {
      const next: ResponsesShape = {
        tasks: { ...prev.tasks, [String(step)]: { text: value, image_url: prev.tasks[String(step)]?.image_url ?? null } },
      };
      scheduleAutosave(next);
      return next;
    });
  }

  function handleTaskImage(step: number, imageUrl: string | null) {
    setResponses((prev) => {
      const next: ResponsesShape = {
        tasks: { ...prev.tasks, [String(step)]: { text: prev.tasks[String(step)]?.text ?? '', image_url: imageUrl } },
      };
      // Image attach/remove is a single deliberate action with no follow-on keystrokes —
      // persist immediately (not via the 3s debounce) to avoid losing the image_url if
      // the user closes the tab before the debounce fires.
      persistDraftNow(next);
      return next;
    });
  }

  async function uploadTaskImage(step: number, blob: Blob): Promise<void> {
    const form = new FormData();
    form.append('file', blob, `task-${step}.png`);
    form.append('attempt_id', attemptId);
    form.append('step', String(step));
    const res = await fetch('/api/attempts/drawing', { method: 'POST', body: form });
    if (!res.ok) throw new Error('upload failed');
    const body = (await res.json()) as { image_url: string };
    handleTaskImage(step, body.image_url);
  }

  function handleFirstInput() {
    // Per-task time accrues from when the task opens; first-input is a no-op
    // marker today (kept for parity + a future hesitation metric).
  }

  // ── Navigation ─────────────────────────────────────────────────────────
  function recordTimeAndMove(nextIndex: number) {
    const now = Date.now();
    const step = tasks[currentIndex]?.step;
    if (typeof step === 'number') {
      taskTimeMs.current[step] = (taskTimeMs.current[step] ?? 0) + (now - taskStartTime.current);
    }
    taskStartTime.current = now;
    setCurrentIndex(nextIndex);
  }

  function handleStart() {
    sessStartMs.current = Date.now();
    taskStartTime.current = Date.now();
    setState('tasks');
  }

  // ── Submit ─────────────────────────────────────────────────────────────
  async function handleSubmit() {
    const sessionAggregates = buildSessionAggregates();
    const perTaskMetrics = buildPerTaskMetrics();
    setState('submitting');

    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);

    try {
      const res = await fetch('/api/attempts/homework-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attempt_id: attemptId,
          responses: responsesRef.current,
          sessionAggregates,
          perTaskMetrics,
        }),
      });

      if (!res.ok) { setState('error'); return; }

      const data = (await res.json()) as SubmitResponse;

      if (data.grading_delayed) {
        setPendingMessage(data.message);
        setState('pending');
        return;
      }

      if (data.result) {
        // Submitted + graded — the draft mirror is no longer needed.
        try { window.localStorage.removeItem(draftKey(attemptId)); } catch { /* ignore */ }
        setResult(data.result);
        setState('graded');
        return;
      }

      setState('error');
    } catch {
      setState('error');
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  if (state === 'graded' && result) {
    return <AssignmentResultScreen result={result} />;
  }
  if (state === 'pending') {
    return <PendingScreen message={pendingMessage} />;
  }
  if (state === 'error') {
    return <ErrorScreen onRetry={() => setState('tasks')} />;
  }
  if (state === 'submitting') {
    return <SubmittingScreen />;
  }
  if (state === 'read') {
    return <ReadPhase content={content} onStart={handleStart} onTtsPlay={() => { sessTtsPlayCount.current += 1; }} />;
  }

  // ── tasks ──────────────────────────────────────────────────────────────
  const steps = tasks.map((t) => t.step);
  const answered: Record<number, boolean> = {};
  for (const t of tasks) answered[t.step] = hasAnswer(responses, t.step);

  const currentTask = tasks[currentIndex] ?? null;
  if (!currentTask) return null;

  const currentText = textFor(responses, currentTask.step);
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === tasks.length - 1;
  const canAdvance = hasAnswer(responses, currentTask.step);
  const canSubmit = tasks.length > 0 && tasks.every((t) => hasAnswer(responses, t.step));

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <TaskRail
        steps={steps}
        currentIndex={currentIndex}
        answered={answered}
        onJump={(i) => recordTimeAndMove(i)}
      />

      <div className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full flex flex-col gap-6">
        <TaskCard
          step={currentTask.step}
          description={currentTask.description}
          value={currentText}
          onChange={(v) => handleTaskChange(currentTask.step, v)}
          onFirstInput={handleFirstInput}
          imageUrl={imageFor(responses, currentTask.step)}
          onSaveImage={(blob) => uploadTaskImage(currentTask.step, blob)}
          onRemoveImage={() => handleTaskImage(currentTask.step, null)}
          onCanvasUsed={() => { canvasUsedRef.current = true; }}
        />
        <TeliPanel attemptId={attemptId} step={currentTask.step} taskDescription={currentTask.description} />
      </div>

      <SubmitPanel
        isFirst={isFirst}
        isLast={isLast}
        canAdvance={canAdvance}
        canSubmit={canSubmit}
        onPrev={() => recordTimeAndMove(Math.max(0, currentIndex - 1))}
        onNext={() => recordTimeAndMove(currentIndex + 1)}
        onSubmit={() => void handleSubmit()}
      />
    </div>
  );
}

export default AssignmentPlayer;
