'use client';

// ChapterTestGenerator — teacher UI for creating, monitoring, and publishing a chapter test.
// Segment 2, Task 6.
//
// States: idle → form → generating (polls every 3s) → ready → published
//                                                    ↘ failed → form (try again)
//         archived (terminal, no actions)
//
// API:
//   POST   /api/teacher/chapter-tests            { chapterId, title, template }  → { chapter_test_id }
//   GET    /api/teacher/chapter-tests/[id]        poll: { generation_status, sections }
//   PATCH  /api/teacher/chapter-tests/[id]        { action: 'publish' }           → { ok }
//
// Token-only styling (no hardcoded hex/arbitrary values).
// User-facing strings → STRINGS-FOR-BARB.md §Chapter Eval.

import React, { useState, useEffect, useRef } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

type Template = 'humanities' | 'stem';
type GenerationStatus = 'draft' | 'queued' | 'generating' | 'ready' | 'failed';
type TestStatus = 'draft' | 'published' | 'archived';

/** Phase drives which UI chunk is rendered. */
type Phase = 'idle' | 'form' | 'generating' | 'ready' | 'published' | 'failed' | 'archived';

interface SectionProgress {
  section_order: number;
  title: string;
  question_counts: Record<string, number>; // includes { total: number, [studentId]: number }
}

export interface ChapterTestGeneratorProps {
  chapterId: string;
  chapterTitle: string;
  existingTest?: {
    id: string;
    title: string;
    status: TestStatus;
    generation_status: GenerationStatus;
  } | null;
}

// ── Phase derivation (pure) ────────────────────────────────────────────────────

function deriveInitialPhase(
  test: ChapterTestGeneratorProps['existingTest'],
): Phase {
  if (!test) return 'idle';
  if (test.status === 'published') return 'published';
  if (test.status === 'archived') return 'archived';
  if (test.generation_status === 'ready') return 'ready';
  if (test.generation_status === 'failed') return 'failed';
  if (
    test.generation_status === 'queued' ||
    test.generation_status === 'generating'
  ) {
    return 'generating';
  }
  // generation_status === 'draft' + status === 'draft'
  return 'idle';
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ChapterTestGenerator({
  chapterId,
  chapterTitle,
  existingTest,
}: ChapterTestGeneratorProps) {
  const [phase, setPhase] = useState<Phase>(() => deriveInitialPhase(existingTest));
  const [testId, setTestId] = useState<string | null>(existingTest?.id ?? null);
  const [testTitle, setTestTitle] = useState(chapterTitle);
  const [template, setTemplate] = useState<Template>('humanities');
  const [sections, setSections] = useState<SectionProgress[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Polling ────────────────────────────────────────────────────────────────

  function stopPolling() {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function startPolling(id: string) {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/teacher/chapter-tests/${id}`);
        if (!res.ok) {
          setError('Could not check test generation status');
          return;
        }
        const data = (await res.json()) as {
          generation_status: string;
          status: string;
          sections: SectionProgress[];
        };

        setSections(data.sections ?? []);

        if (data.generation_status === 'ready') {
          stopPolling();
          setPhase('ready');
        } else if (data.generation_status === 'failed') {
          stopPolling();
          setPhase('failed');
          setError('Test generation failed. Please try again.');
        }
        // 'queued' / 'generating': keep polling
      } catch {
        setError('Network error while checking generation status');
        stopPolling();
      }
    }, 3000);
  }

  // Start / stop polling when phase or testId changes
  useEffect(() => {
    if (phase === 'generating' && testId) {
      startPolling(testId);
    } else {
      stopPolling();
    }

    // Cleanup on unmount or dependency change
    return () => {
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, testId]);

  // ── Create handler ─────────────────────────────────────────────────────────

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = testTitle.trim();
    if (!title) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/teacher/chapter-tests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chapterId, title, template }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? 'Could not create chapter test');
        return;
      }

      const data = (await res.json()) as { chapter_test_id: string };
      setTestId(data.chapter_test_id);
      setPhase('generating');
      // Polling starts via useEffect above
    } catch {
      setError('Network error — could not create chapter test');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Publish handler ────────────────────────────────────────────────────────

  const handlePublish = async () => {
    if (!testId) return;
    setIsPublishing(true);
    setError(null);

    try {
      const res = await fetch(`/api/teacher/chapter-tests/${testId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'publish' }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? 'Could not publish test');
        return;
      }

      setPhase('published');
    } catch {
      setError('Network error — could not publish test');
    } finally {
      setIsPublishing(false);
    }
  };

  // ── Try again handler ──────────────────────────────────────────────────────

  const handleTryAgain = () => {
    setPhase('form');
    setTestId(null);
    setError(null);
    setSections([]);
  };

  // ── Published ──────────────────────────────────────────────────────────────

  if (phase === 'published') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-sidebar-edge bg-ok-surface px-3 py-2 text-sm">
        <span className="font-bold text-ok">✓ Published</span>
        <span className="text-fg-muted">{existingTest?.title ?? testTitle}</span>
      </div>
    );
  }

  // ── Archived ───────────────────────────────────────────────────────────────

  if (phase === 'archived') {
    return (
      <div className="rounded-lg border border-sidebar-edge bg-surface px-3 py-2 text-sm text-fg-muted">
        Archived
      </div>
    );
  }

  // ── Generating ─────────────────────────────────────────────────────────────

  if (phase === 'generating') {
    return (
      <div
        className="rounded-lg border border-sidebar-edge bg-surface p-3"
        aria-live="polite"
        aria-label="Building chapter test"
      >
        <div className="mb-2 flex items-center gap-2">
          <span aria-hidden="true" className="inline-block animate-spin text-brand">
            ⟳
          </span>
          <span className="text-sm font-semibold text-fg">Building test…</span>
        </div>

        {sections.length > 0 && (
          <ul className="flex flex-col gap-1">
            {sections.map((s) => (
              <li key={s.section_order} className="text-xs text-fg-muted">
                Section {s.section_order}:{' '}
                {(s.question_counts.total ?? 0) > 0
                  ? `${s.question_counts.total} students ready`
                  : 'Building…'}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ── Ready ──────────────────────────────────────────────────────────────────

  if (phase === 'ready') {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-sidebar-edge bg-surface p-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ok">✓ Questions ready</span>
        </div>

        {error && (
          <p role="alert" className="text-xs text-risk">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handlePublish}
            disabled={isPublishing}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-bold text-fg-on-brand disabled:opacity-50"
          >
            {isPublishing ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </div>
    );
  }

  // ── Failed ─────────────────────────────────────────────────────────────────

  if (phase === 'failed') {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-sidebar-edge bg-risk-surface p-3">
        <p className="text-sm text-risk">
          {error ?? 'Something went wrong generating the test.'}
        </p>
        <button
          type="button"
          onClick={handleTryAgain}
          className="self-start rounded-lg border border-risk px-3 py-1.5 text-sm font-semibold text-risk hover:bg-risk-surface"
        >
          Try again
        </button>
      </div>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────

  if (phase === 'form') {
    return (
      <form
        onSubmit={handleCreate}
        className="flex flex-col gap-2 rounded-lg border border-sidebar-edge bg-surface p-3"
      >
        {error && (
          <p role="alert" className="text-xs text-risk">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-1">
          <label
            htmlFor="chapter-test-title"
            className="text-xs font-bold text-fg-muted"
          >
            Test title
          </label>
          <input
            id="chapter-test-title"
            type="text"
            value={testTitle}
            onChange={(e) => setTestTitle(e.target.value)}
            required
            className="rounded border border-sidebar-edge bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="chapter-test-template"
            className="text-xs font-bold text-fg-muted"
          >
            Template
          </label>
          <select
            id="chapter-test-template"
            value={template}
            onChange={(e) => setTemplate(e.target.value as Template)}
            className="rounded border border-sidebar-edge bg-surface px-3 py-1.5 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          >
            <option value="humanities">Humanities</option>
            <option value="stem">STEM</option>
          </select>
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isSubmitting || !testTitle.trim()}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-bold text-fg-on-brand disabled:opacity-50"
          >
            {isSubmitting ? 'Creating…' : 'Generate Test'}
          </button>
          <button
            type="button"
            onClick={() => {
              setPhase('idle');
              setTestTitle(chapterTitle);
              setError(null);
            }}
            className="rounded-lg border border-sidebar-edge px-3 py-1.5 text-sm text-fg hover:bg-surface"
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  // ── Idle (phase === 'idle') ────────────────────────────────────────────────

  return (
    <button
      type="button"
      onClick={() => setPhase('form')}
      className="rounded-lg border-2 border-dashed border-sidebar-edge px-3 py-1.5 text-sm font-bold text-fg-muted hover:border-brand hover:text-fg"
    >
      Create Chapter Test
    </button>
  );
}

export default ChapterTestGenerator;
