'use client';

/**
 * UrlImportStudio — the "From a URL" tab. Imports a public/link-shared URL OR a
 * Google Drive file into a lesson, runs the fuzzy-duplicate gate, then drafts a quiz.
 * Drive URLs are detected client-side via parseDriveUrl() and routed to /import-drive;
 * all other URLs use the existing /import-url path unchanged.
 * Token-only; deep-ink; strings DRAFT → Barb (§GC Seg 5).
 */
import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { detectDuplicates, type LessonRowLite } from '@/lib/lessons/duplicateDetect';
import { DupModal } from './DupModal';
import { readErrorMessage } from './errorMessage';
import type { UploadLessonLite } from './UploadStudio';
import { SectionLabel } from '../../_components/SectionLabel';
import { parseDriveUrl } from '@/lib/google/drive';

export interface UrlImportStudioProps {
  classId: string;
  existingLessons: UploadLessonLite[];
}

type Phase = 'idle' | 'importing' | 'checking' | 'building' | 'done' | 'error' | 'not_connected';

const INPUT = 'rounded-md border-2 border-sidebar-edge bg-bg px-3 py-2 text-fg text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

export function UrlImportStudio({ classId, existingLessons }: UrlImportStudioProps): React.JSX.Element {
  const [url, setUrl] = useState('');
  const [driveFileId, setDriveFileId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fuzzyMatch, setFuzzyMatch] = useState<LessonRowLite | null>(null);
  const lessonIdRef = useRef<string | null>(null);

  const lessonsHref = `/library/lessons?class=${encodeURIComponent(classId)}`;
  const quizzesHref = `/library/quizzes?class=${encodeURIComponent(classId)}`;
  const busy = phase === 'importing' || phase === 'checking' || phase === 'building';

  function fail(message: string) { setError(message); setPhase('error'); }

  function handleUrlChange(value: string) {
    setUrl(value);
    setDriveFileId(parseDriveUrl(value));
  }

  function archivePendingLesson() {
    const lessonId = lessonIdRef.current;
    if (!lessonId) return;
    void fetch('/api/teacher/lessons/manage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lesson_id: lessonId, action: 'archive' }),
    }).catch(() => {});
  }

  async function doGenerate(lessonId: string) {
    setPhase('building');
    const res = await fetch('/api/teacher/quizzes/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lesson_id: lessonId }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      fail(readErrorMessage(errBody, "The quiz didn't draft — try the link again."));
      return;
    }
    setPhase('done');
  }

  async function onImport() {
    if (!url.trim() || busy) return;
    setError(null); setFuzzyMatch(null);
    setPhase('importing');

    // Branch: Drive URL → /import-drive (file_id); generic URL → /import-url (url)
    const endpoint = driveFileId
      ? '/api/teacher/lessons/import-drive'
      : '/api/teacher/lessons/import-url';
    const requestBody = driveFileId
      ? { file_id: driveFileId, class_id: classId }
      : { url: url.trim(), class_id: classId };

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
    } catch { fail("We couldn't reach that link."); return; }

    if (res.ok) {
      const body = await res.json().catch(() => null);
      const resp = body as Record<string, unknown> | null;

      // gcErrorResponse from /import-drive returns HTTP 200 with { connected: false }
      // when the teacher hasn't connected Google (or refresh failed).
      if (driveFileId && resp?.['connected'] === false) {
        setPhase('not_connected');
        return;
      }

      const parsed = resp as { lesson_id?: string; parsed_content?: { title?: string | null; key_concepts?: string[] } } | null;
      if (!parsed?.lesson_id) { fail("That didn't import — try again."); return; }
      lessonIdRef.current = parsed.lesson_id;
      const parsedContent = parsed.parsed_content ?? {};

      setPhase('checking');
      const candidate = {
        title: parsedContent.title ?? null,
        concept_tags: Array.isArray(parsedContent.key_concepts) ? parsedContent.key_concepts : [],
      };
      const matches = detectDuplicates(candidate, existingLessons as LessonRowLite[]);
      if (matches.length > 0) { setFuzzyMatch(matches[0].lesson); setPhase('idle'); return; }
      await doGenerate(parsed.lesson_id);
    } else {
      const body = await res.json().catch(() => null);
      fail(readErrorMessage(body, "That didn't import — check the link and try again."));
    }
  }

  function onCreateAnyway() {
    const lessonId = lessonIdRef.current;
    setFuzzyMatch(null);
    if (lessonId) void doGenerate(lessonId).catch(() => fail("The quiz didn't draft — try the link again."));
  }
  function onCancelFuzzy() { archivePendingLesson(); setFuzzyMatch(null); setPhase('idle'); }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="font-display text-sm font-extrabold text-fg">Paste a link</span>
        <span className="text-fg text-sm">
          A public web page, a shared Google Doc, or a linked Drive file.
          We&apos;ll read it and draft a quiz.
        </span>
        <input
          className={INPUT} type="url" inputMode="url" value={url} aria-label="Link or web address"
          onChange={(e) => handleUrlChange(e.target.value)} placeholder="https://…"
        />
      </label>

      {driveFileId && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-lg border-2 border-sidebar-edge bg-surface px-3 py-2 text-fg text-sm shadow-sticker"
        >
          <SectionLabel tone="brand">Google Drive</SectionLabel>
          <span>Google Drive file detected — uses your connected Google account.</span>
        </div>
      )}

      <div>
        <button
          type="button" onClick={onImport} disabled={!url.trim() || busy}
          className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
        >Import</button>
      </div>

      {busy && (
        <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-lg border-2 border-sidebar-edge bg-surface p-4 shadow-sticker">
          <SectionLabel tone="brand">Working</SectionLabel>
          <span className="text-fg text-sm">
            {phase === 'importing' ? 'Reading that link…' : phase === 'checking' ? 'Checking your library…' : 'Building a quiz…'}
          </span>
        </div>
      )}

      {phase === 'not_connected' && (
        <p role="alert" className="rounded-lg border-2 border-sidebar-edge bg-warn-surface p-4 text-fg text-sm shadow-sticker">
          Connect your Google account to import Drive files.{' '}
          <Link href="/settings/google" className="font-bold underline">Connect Google</Link>
        </p>
      )}

      {phase === 'error' && error && (
        <p role="alert" className="rounded-lg border-2 border-sidebar-edge bg-warn-surface p-4 text-fg text-sm shadow-sticker">{error}</p>
      )}

      {phase === 'done' && (
        <div data-testid="upload-done" className="flex flex-col gap-3 rounded-lg border-2 border-sidebar-edge bg-ok-surface p-5 shadow-sticker">
          <SectionLabel tone="ok">Quiz ready</SectionLabel>
          <p className="font-display text-base font-bold text-fg">Lesson imported and a quiz is drafted.</p>
          <p className="text-fg text-sm">Review and publish the quiz when it&apos;s ready for students.</p>
          <div className="flex flex-wrap gap-2">
            <Link href={quizzesHref} className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker">
              Open the Quiz Library
            </Link>
            <Link href={lessonsHref} className="rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker">
              Back to the Lesson Library
            </Link>
          </div>
        </div>
      )}

      {fuzzyMatch && (
        <DupModal testId="fuzzy-dup-modal" title="This looks a lot like a lesson you already have." onClose={onCancelFuzzy}>
          <p className="text-fg text-sm">It&apos;s close to <span className="font-bold">{fuzzyMatch.title ?? 'an existing lesson'}</span>.</p>
          <div className="flex flex-wrap gap-2">
            <Link href={lessonsHref} onClick={archivePendingLesson} className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker">Use that one</Link>
            <button type="button" onClick={onCreateAnyway} className="rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker">Create anyway</button>
            <button type="button" onClick={onCancelFuzzy} className="rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker">Cancel</button>
          </div>
        </DupModal>
      )}
    </div>
  );
}

export default UrlImportStudio;
