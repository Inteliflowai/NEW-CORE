'use client';

/**
 * UploadStudio — the Content Studio upload orchestrator (Seg 1).
 *
 * A teacher drops a PDF / Word doc / text file; this component drives the whole loop client-side
 * by chaining three EXISTING auth-guarded routes (no server-side duplication of engine logic):
 *
 *   1. POST /api/teacher/lessons/upload      (multipart) — stores the file + creates a draft lesson.
 *      • 409 {duplicate}  → exact file-hash dup modal: "Open it" (→ Lesson Library) / "Upload anyway"
 *        (re-POST with force=true).
 *   2. POST /api/teacher/lessons/parse       {lesson_id} — parses the lesson → {parsed_content}.
 *      • Then the PURE ported detectDuplicates(...) runs the fuzzy (title+tags Jaccard) check against
 *        the teacher's existing lessons. A match gates step 3 behind the 3-option modal:
 *        "Use that one" (→ Lesson Library) / "Create anyway" (continue) / "Cancel" (stop).
 *   3. POST /api/teacher/quizzes/generate     {lesson_id} — drafts a quiz (status='draft' — NOT
 *      student-visible until a teacher publishes it from the Quiz Library).
 *
 * Done state links to the Lesson + Quiz Libraries (carrying ?class= forward).
 *
 * "Assignments", never "Homework". Token-only Tailwind v4 (no hardcoded hex / arbitrary [var(--..)]);
 * content text is deep-ink (text-fg). Pop-art chrome: border-2 border-sidebar-edge + shadow-sticker.
 * Reduced-motion-safe (no required motion). All user-facing strings are DRAFTS → Barb
 * (STRINGS-FOR-BARB.md §Content Studio).
 */

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { EmptyState } from '@/components/core/EmptyState';
import { SectionLabel } from '../../_components/SectionLabel';
import { detectDuplicates, type LessonRowLite } from '@/lib/lessons/duplicateDetect';

/** A teacher's existing lesson, trimmed to what the fuzzy check needs (concept_tags from
 *  parsed_content.key_concepts). Supplied by the server page (archived excluded). */
export interface UploadLessonLite {
  id: string;
  title: string | null;
  concept_tags: string[];
  status: string;
}

export interface UploadStudioProps {
  classId: string;
  existingLessons: UploadLessonLite[];
}

/** The orchestration phases the UI surfaces (progress labels are DRAFT → Barb). */
type Phase = 'idle' | 'uploading' | 'reading' | 'checking' | 'building' | 'done' | 'error';

const PHASE_LABEL: Record<Exclude<Phase, 'idle' | 'done' | 'error'>, string> = {
  uploading: 'Uploading your lesson…',
  reading: 'Reading your lesson…',
  checking: 'Checking your library…',
  building: 'Building a quiz…',
};

const ACCEPT = '.pdf,.docx,.txt';
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);
function isAllowed(file: File): boolean {
  if (ALLOWED_TYPES.has(file.type)) return true;
  // Some browsers leave File.type blank — fall back to the extension.
  return /\.(pdf|docx|txt)$/i.test(file.name);
}

/** A near-duplicate the fuzzy check surfaced (the modal lists its title + links to it). */
interface ExactDup {
  existing_lesson_id: string;
  existing_title: string | null;
}

export function UploadStudio({ classId, existingLessons }: UploadStudioProps): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Result links shown on the done state.
  const [quizId, setQuizId] = useState<string | null>(null);

  // Modal state — exact (server 409) + fuzzy (detectDuplicates) dups.
  const [exactDup, setExactDup] = useState<ExactDup | null>(null);
  const [fuzzyMatch, setFuzzyMatch] = useState<LessonRowLite | null>(null);

  // Carried across the async chain (force-retry + post-modal continuation).
  const pendingFileRef = useRef<File | null>(null);
  const lessonIdRef = useRef<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const lessonsHref = `/library/lessons?class=${encodeURIComponent(classId)}`;
  const quizzesHref = `/library/quizzes?class=${encodeURIComponent(classId)}`;

  function resetTransient() {
    setError(null);
    setExactDup(null);
    setFuzzyMatch(null);
    setQuizId(null);
  }

  // ── Step 1: upload (multipart). force re-POSTs past an exact dup. ──────────
  async function doUpload(file: File, force: boolean): Promise<void> {
    setPhase('uploading');
    const form = new FormData();
    form.append('file', file);
    form.append('class_id', classId);
    if (force) form.append('force', 'true');

    const res = await fetch('/api/teacher/lessons/upload', { method: 'POST', body: form });

    if (res.status === 409) {
      const body = (await res.json()) as {
        existing_lesson_id?: string;
        existing_title?: string | null;
      };
      setExactDup({
        existing_lesson_id: body.existing_lesson_id ?? '',
        existing_title: body.existing_title ?? null,
      });
      setPhase('idle');
      return;
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      fail(body?.error ?? "That didn't go through — try again in a moment.");
      return;
    }

    const body = (await res.json()) as { lesson_id: string };
    lessonIdRef.current = body.lesson_id;
    setExactDup(null);
    await doParse(body.lesson_id);
  }

  // ── Step 2: parse, then the fuzzy duplicate check. ─────────────────────────
  async function doParse(lessonId: string): Promise<void> {
    setPhase('reading');
    const res = await fetch('/api/teacher/lessons/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lesson_id: lessonId }),
    });
    if (!res.ok) {
      fail("We couldn't read that file — try a clearer copy.");
      return;
    }
    const body = (await res.json()) as {
      parsed_content?: { title?: string | null; key_concepts?: string[] };
    };
    const parsed = body.parsed_content ?? {};

    setPhase('checking');
    const candidate = {
      title: parsed.title ?? null,
      concept_tags: Array.isArray(parsed.key_concepts) ? parsed.key_concepts : [],
    };
    const matches = detectDuplicates(candidate, existingLessons as LessonRowLite[]);
    if (matches.length > 0) {
      // Gate quiz-gen behind the teacher's call.
      setFuzzyMatch(matches[0].lesson);
      setPhase('idle');
      return;
    }
    await doGenerate(lessonId);
  }

  // ── Step 3: draft the quiz. ────────────────────────────────────────────────
  async function doGenerate(lessonId: string): Promise<void> {
    setPhase('building');
    const res = await fetch('/api/teacher/quizzes/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lesson_id: lessonId }),
    });
    if (!res.ok) {
      fail("The quiz didn't draft — you can try again from the Lesson Library.");
      return;
    }
    const body = (await res.json()) as { quiz_id?: string };
    setQuizId(body.quiz_id ?? null);
    setPhase('done');
  }

  function fail(message: string) {
    setError(message);
    setPhase('error');
  }

  // ── Entry: a teacher chose / dropped a file. ───────────────────────────────
  function onFile(file: File | null | undefined) {
    if (!file) return;
    resetTransient();
    if (!isAllowed(file)) {
      fail('Upload a PDF, Word doc, or text file.');
      return;
    }
    pendingFileRef.current = file;
    void doUpload(file, false).catch(() => fail("That didn't go through — try again in a moment."));
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    onFile(e.target.files?.[0]);
    // Allow re-selecting the same file later.
    e.target.value = '';
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    onFile(e.dataTransfer.files?.[0]);
  }

  // Modal actions.
  function onUploadAnyway() {
    const file = pendingFileRef.current;
    setExactDup(null);
    if (!file) return;
    void doUpload(file, true).catch(() => fail("That didn't go through — try again in a moment."));
  }
  function onCreateAnyway() {
    const lessonId = lessonIdRef.current;
    setFuzzyMatch(null);
    if (!lessonId) return;
    void doGenerate(lessonId).catch(() => fail("The quiz didn't draft — try again."));
  }
  function onCancelFuzzy() {
    // Stop the flow; the draft lesson stays in the library for later.
    setFuzzyMatch(null);
    setPhase('idle');
  }

  const busy = phase === 'uploading' || phase === 'reading' || phase === 'checking' || phase === 'building';

  return (
    <div className="flex flex-col gap-5">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={[
          'flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-sidebar-edge bg-surface p-8 text-center shadow-sticker',
          dragging ? 'bg-brand-surface' : '',
        ].filter(Boolean).join(' ')}
      >
        <p className="font-display text-base font-bold text-fg">Drop a lesson here</p>
        <p className="text-fg text-sm">PDF, Word doc, or text file. We&apos;ll draft a quiz from it.</p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
        >
          Choose a file
        </button>
        <input
          ref={fileInputRef}
          data-testid="upload-file-input"
          type="file"
          accept={ACCEPT}
          onChange={onInputChange}
          className="sr-only"
        />
      </div>

      {/* Progress */}
      {busy && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 rounded-lg border-2 border-sidebar-edge bg-surface p-4 shadow-sticker"
        >
          <SectionLabel tone="brand">Working</SectionLabel>
          <span className="text-fg text-sm">{PHASE_LABEL[phase as keyof typeof PHASE_LABEL]}</span>
        </div>
      )}

      {/* Inline error */}
      {phase === 'error' && error && (
        <p role="alert" className="rounded-lg border-2 border-sidebar-edge bg-warn-surface p-4 text-fg text-sm shadow-sticker">
          {error}
        </p>
      )}

      {/* Done */}
      {phase === 'done' && (
        <div
          data-testid="upload-done"
          className="flex flex-col gap-3 rounded-lg border-2 border-sidebar-edge bg-ok-surface p-5 shadow-sticker"
        >
          <SectionLabel tone="ok">Quiz ready</SectionLabel>
          <p className="font-display text-base font-bold text-fg">Lesson added and a quiz is drafted.</p>
          <p className="text-fg text-sm">Review and publish the quiz when it&apos;s ready for students.</p>
          <div className="flex flex-wrap gap-2">
            <Link
              href={quizzesHref}
              className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker"
            >
              {quizId ? 'Open the quiz' : 'Open the Quiz Library'}
            </Link>
            <Link
              href={lessonsHref}
              className="rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker"
            >
              Back to the Lesson Library
            </Link>
          </div>
        </div>
      )}

      {/* Exact-duplicate modal (server 409) */}
      {exactDup && (
        <DupModal testId="exact-dup-modal" title="You already uploaded this file." onClose={() => setExactDup(null)}>
          <p className="text-fg text-sm">
            This looks like a copy of{' '}
            <span className="font-bold">{exactDup.existing_title ?? 'a lesson you already have'}</span>.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href={lessonsHref}
              className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker"
            >
              Open it
            </Link>
            <button
              type="button"
              onClick={onUploadAnyway}
              className="rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker"
            >
              Upload anyway
            </button>
          </div>
        </DupModal>
      )}

      {/* Fuzzy-duplicate modal (detectDuplicates) — gates quiz-gen */}
      {fuzzyMatch && (
        <DupModal testId="fuzzy-dup-modal" title="This looks a lot like a lesson you already have." onClose={onCancelFuzzy}>
          <p className="text-fg text-sm">
            It&apos;s close to{' '}
            <span className="font-bold">{fuzzyMatch.title ?? 'an existing lesson'}</span>.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href={lessonsHref}
              className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker"
            >
              Use that one
            </Link>
            <button
              type="button"
              onClick={onCreateAnyway}
              className="rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker"
            >
              Create anyway
            </button>
            <button
              type="button"
              onClick={onCancelFuzzy}
              className="rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker"
            >
              Cancel
            </button>
          </div>
        </DupModal>
      )}

      {/* Idle helper — only when nothing else is showing. */}
      {phase === 'idle' && !exactDup && !fuzzyMatch && (
        <EmptyState
          variant="just-getting-started"
          titleOverride="Start with a lesson"
          bodyOverride="Drop a file above and we'll draft a quiz you can review."
        />
      )}
    </div>
  );
}

const FOCUSABLE = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

interface DupModalProps {
  testId: string;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

/** A small centered modal mirroring the gradebook drill-in a11y pattern: role="dialog", focus
 *  trap, Escape-to-close, click-scrim-to-close, focus restoration to the trigger. */
function DupModal({ testId, title, onClose, children }: DupModalProps): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    closeRef.current?.focus();
    return () => { triggerRef.current?.focus?.(); };
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key === 'Tab') {
      const root = panelRef.current;
      if (!root) return;
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => !n.hasAttribute('disabled'));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    }
  }

  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-20 bg-fg/30" />
      <div
        ref={panelRef}
        data-testid={testId}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={onKeyDown}
        className="fixed left-1/2 top-1/2 z-30 flex w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg border-2 border-sidebar-edge bg-surface p-5 shadow-sticker-lg"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-base font-extrabold text-fg">{title}</h2>
          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
            aria-label="Close"
            className="rounded-md border-2 border-sidebar-edge px-2 py-1 text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

export default UploadStudio;
