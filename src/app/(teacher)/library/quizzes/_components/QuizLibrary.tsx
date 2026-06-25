'use client';

/**
 * QuizLibrary — the teacher's flat, searchable list of quizzes for a class, plus a click-a-row
 * detail/edit panel that edits the quiz title + per-question text/choices/rubric and runs the
 * lifecycle actions (Publish / Unpublish / Archive) through POST /api/teacher/quizzes/manage.
 *
 * STUDENT-VISIBILITY: a quiz is student-visible ONLY at status='published' (+ published_at). The
 * "Publish" action flips both server-side (the route is the gate; the client cannot be trusted).
 * "Unpublish" pulls it back; "Archive" soft-deletes it (status='archived', no archived_at column).
 *
 * This is a TEACHER-ONLY surface, so question counts / digits are allowed at their render sites;
 * all surrounding PROSE stays banned-word-free (leakGuard.ts). "Assignments", never "Homework".
 * Token-only Tailwind v4 (no hardcoded hex / arbitrary [var(--..)]); content text is deep-ink.
 *
 * The detail/edit panel mirrors the gradebook drill-in: a right-side role="dialog" with focus
 * trapping, Escape-to-close, click-scrim-to-close, and focus restoration to the originating row.
 * After any successful write it router.refresh()es so the list reflects the new status.
 *
 * All user-facing strings are DRAFTS → Barb (STRINGS-FOR-BARB.md §Content Studio).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EmptyState } from '@/components/core/EmptyState';
import { SectionLabel } from '../../../_components/SectionLabel';
import { CategoryFilterBar } from '../../_components/CategoryFilterBar';
import type { QuizLibrary as QuizLibraryData, QuizLibRow } from '@/lib/quizzes/loadQuizLibrary';
import type { LibraryClassOption } from '@/lib/teacher/teacherClasses';
import { inBucket, type DateBucket } from '@/lib/content/dateBucket';
import { clean, distinctValues, groupByCategory } from '@/lib/content/category';

/** A quiz question, as the edit panel needs it (subset of quiz_questions). */
export interface QuizQuestionLite {
  id: string;
  position: number;
  question_type: string;
  question_text: string;
  choices: string[] | null;
  rubric: string | null;
}

export interface QuizLibraryProps {
  data: QuizLibraryData;
  classId: string;
  /** Per-quiz question rows for the edit panel (keyed by quiz_id). Optional — when a quiz's
   *  questions aren't supplied, the panel still edits the title + runs lifecycle actions. */
  questions?: Record<string, QuizQuestionLite[]>;
  /** The teacher's classes for the Class selector (rendered only when >1). Optional. */
  classes?: LibraryClassOption[];
  /** Injectable clock (tests pass a fixed date); defaults to real now. */
  now?: Date;
  /** When set, shows "Publish to Classroom" on each row (fetched server-side via admin client).
   *  Absent/null → the action is hidden (class is not GC-mirrored). */
  googleCourseId?: string | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Banned-word-free published-date label. DRAFT → Barb. */
function publishedDateLabel(iso: string): string {
  const d = new Date(iso);
  return `Published ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Status pill text (number-free, banned-word-free). DRAFT → Barb. */
function statusWord(status: string): string {
  if (status === 'published') return 'Published';
  return 'Draft';
}

/** True when the quiz has 0 questions — it is still being built in the background. */
function isBuilding(row: QuizLibRow): boolean {
  return row.question_count === 0 && row.status !== 'archived';
}

/** Per-quiz GC publish state: idle | busy | done | needsReconnect. */
type GcPublishState = 'idle' | 'busy' | 'done' | 'needsReconnect';

export function QuizLibrary({ data, classId, questions, classes = [], now, googleCourseId }: QuizLibraryProps) {
  const clock = now ?? new Date();
  const [search, setSearch] = useState('');
  // Calendar buckets (shared with the Lesson Library) so "Today"/"This week" mean the same on both.
  const [granularity, setGranularity] = useState<DateBucket>('all');
  const [subject, setSubject] = useState('all');
  const [grade, setGrade] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Per-quiz GC publish state (keyed by quiz id).
  const [gcState, setGcState] = useState<Record<string, GcPublishState>>({});

  async function publishToClassroom(quizId: string) {
    if (gcState[quizId] === 'busy') return;
    setGcState((s) => ({ ...s, [quizId]: 'busy' }));
    try {
      const res = await fetch('/api/teacher/google/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId, resourceType: 'quiz', resourceId: quizId }),
      });
      const json = await res.json() as { ok?: boolean; needsReconnect?: boolean; connected?: boolean };
      // gcErrorResponse returns HTTP 200 for typed GC errors (connected:false / needsReconnect:true).
      // Checking res.ok first would miss those — branch on the body fields (M3-fix).
      if (json.needsReconnect === true || json.connected === false) {
        setGcState((s) => ({ ...s, [quizId]: 'needsReconnect' }));
      } else if (res.ok && json.ok) {
        setGcState((s) => ({ ...s, [quizId]: 'done' }));
      } else {
        setGcState((s) => ({ ...s, [quizId]: 'idle' }));
      }
    } catch {
      setGcState((s) => ({ ...s, [quizId]: 'idle' }));
    }
  }

  const subjectOptions = useMemo(() => distinctValues(data.quizzes, (q) => q.subject), [data.quizzes]);
  const gradeOptions = useMemo(() => distinctValues(data.quizzes, (q) => q.grade_level), [data.quizzes]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.quizzes.filter((row) => {
      if (!inBucket(row.created_at, granularity, clock)) return false;
      // Compare via clean() so a whitespace-bearing inherited value matches its trimmed dropdown option.
      if (subject !== 'all' && clean(row.subject) !== subject) return false;
      if (grade !== 'all' && clean(row.grade_level) !== grade) return false;
      if (!q) return true;
      const hay = `${row.title} ${row.lesson_title ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [data.quizzes, search, granularity, subject, grade, clock]);

  const groups = useMemo(() => groupByCategory(filtered), [filtered]);
  const selected = selectedId ? data.quizzes.find((r) => r.id === selectedId) ?? null : null;

  if (data.quizzes.length === 0) {
    return (
      <EmptyState
        variant="just-getting-started"
        titleOverride="No checks yet"
        bodyOverride="Upload a lesson and a check is drafted for you. Publish it when it's ready for students."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <CategoryFilterBar
        classes={classes}
        currentClassId={classId}
        classBasePath="/library/quizzes"
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Find a check…"
        subjects={subjectOptions}
        subject={subject}
        onSubject={setSubject}
        grades={gradeOptions}
        grade={grade}
        onGrade={setGrade}
        bucket={granularity}
        onBucket={setGranularity}
        dateLabel="When"
      />

      {/* Grouped list — Subject · Grade section headers */}
      {filtered.length === 0 ? (
        <p className="text-sm text-fg-muted">Nothing matches that. Try a different search.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <section key={group.key} className="flex flex-col gap-3">
              <h2 className="font-display text-xs font-extrabold uppercase tracking-[0.16em] text-fg-muted">
                {group.label}
              </h2>
              <ul className="flex flex-col gap-3">
                {group.items.map((row) => {
                  const building = isBuilding(row);
                  const gcRowState = gcState[row.id] ?? 'idle';
                  return (
                    <li key={row.id} className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedId(row.id)}
                        aria-label={building ? `${row.title} — Building` : `${row.title} — ${statusWord(row.status)}`}
                        className="flex w-full flex-col gap-1 rounded-lg border-2 border-sidebar-edge bg-surface p-4 text-left shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-display text-base font-extrabold text-fg">{row.title}</span>
                          {building ? (
                            <SectionLabel tone="brand">Building…</SectionLabel>
                          ) : (
                            <SectionLabel tone={row.status === 'published' ? 'ok' : 'warn'}>
                              {statusWord(row.status)}
                            </SectionLabel>
                          )}
                        </span>
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg">
                          {row.lesson_title && <span>{row.lesson_title}</span>}
                          {building ? (
                            <span role="status" className="text-fg-muted">Questions on their way — check back in a moment.</span>
                          ) : (
                            <span className="text-fg-muted">
                              {row.question_count === 1 ? '1 question' : `${row.question_count} questions`}
                            </span>
                          )}
                          {row.published_at && (
                            <span className="text-fg-muted">{publishedDateLabel(row.published_at)}</span>
                          )}
                        </span>
                      </button>
                      {/* GC publish — gated on googleCourseId (threaded from server page) */}
                      {googleCourseId && (
                        <div className="flex items-center gap-2 px-1">
                          {gcRowState === 'done' ? (
                            <span className="text-sm text-fg-muted">Sent to Classroom</span>
                          ) : gcRowState === 'needsReconnect' ? (
                            <a
                              href="/settings/google"
                              className="text-sm font-bold text-brand underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                            >
                              Reconnect Google
                            </a>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void publishToClassroom(row.id)}
                              disabled={gcRowState === 'busy'}
                              className="rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1 text-sm font-bold text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
                            >
                              {gcRowState === 'busy' ? 'Publishing…' : 'Publish to Classroom'}
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {selected && (
        <QuizEditPanel
          quiz={selected}
          classId={classId}
          questions={questions?.[selected.id] ?? null}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

const FOCUSABLE = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

interface QuizEditPanelProps {
  quiz: QuizLibRow;
  classId: string;
  questions: QuizQuestionLite[] | null;
  onClose: () => void;
}

function QuizEditPanel({ quiz, classId, questions, onClose }: QuizEditPanelProps) {
  const router = useRouter();
  const isPublished = quiz.status === 'published';
  // A quiz with 0 questions is still being built in the background — publishing it is not allowed.
  const isStillBuilding = isBuilding(quiz);

  const [title, setTitle] = useState(quiz.title);
  const [edited, setEdited] = useState<Record<string, { question_text: string; rubric: string }>>(() => {
    const seed: Record<string, { question_text: string; rubric: string }> = {};
    for (const q of questions ?? []) seed[q.id] = { question_text: q.question_text, rubric: q.rubric ?? '' };
    return seed;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function manage(payload: Record<string, unknown>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/teacher/quizzes/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quiz_id: quiz.id, ...payload }),
      });
      if (!res.ok) { setError("That didn't save — try again in a moment."); return false; }
      return true;
    } catch {
      setError("That didn't save — try again in a moment.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function afterWrite(ok: boolean, close: boolean) {
    if (!ok) return;
    router.refresh();
    if (close) onClose();
  }

  function onSave() {
    const payload: Record<string, unknown> = { action: 'edit', title: title.trim() };
    const questionPatches = (questions ?? []).map((q) => ({
      id: q.id,
      question_text: edited[q.id]?.question_text ?? q.question_text,
      rubric: (edited[q.id]?.rubric ?? q.rubric ?? '').trim() === '' ? null : edited[q.id]?.rubric ?? q.rubric,
    }));
    if (questionPatches.length > 0) payload.questions = questionPatches;
    void manage(payload).then((ok) => afterWrite(ok, false));
  }

  function onPublish() { void manage({ action: 'publish' }).then((ok) => afterWrite(ok, true)); }
  function onUnpublish() { void manage({ action: 'unpublish' }).then((ok) => afterWrite(ok, false)); }
  function onArchive() { void manage({ action: 'archive' }).then((ok) => afterWrite(ok, true)); }

  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-20 bg-fg/30" />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${quiz.title}`}
        onKeyDown={onKeyDown}
        className="fixed inset-y-0 right-0 z-30 flex w-full max-w-lg flex-col gap-4 overflow-y-auto border-l-2 border-sidebar-edge bg-surface p-5 shadow-sticker-lg"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-lg font-extrabold text-fg">Edit check</h2>
            <SectionLabel tone={isPublished ? 'ok' : 'warn'}>{statusWord(quiz.status)}</SectionLabel>
          </div>
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

        {isPublished && (
          <p className="text-sm text-fg-muted">Published — students can see it now.</p>
        )}
        {isStillBuilding && (
          <p role="status" className="text-sm text-fg">
            Questions are being built. Come back in a moment to publish.
          </p>
        )}

        {/* Title */}
        <div className="flex flex-col gap-1">
          <label htmlFor="quiz-title" className="text-sm font-bold text-fg">Title</label>
          <input
            id="quiz-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            className="w-full rounded-md border-2 border-sidebar-edge bg-bg px-2 py-1 text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          />
        </div>

        {/* Per-question editor (only when this quiz's questions were supplied) */}
        {questions && questions.length > 0 && (
          <div className="flex flex-col gap-4 border-t-2 border-sidebar-edge pt-4">
            {questions.map((q, i) => (
              <div key={q.id} className="flex flex-col gap-2 rounded-md border-2 border-sidebar-edge bg-bg p-3">
                <label htmlFor={`q-text-${q.id}`} className="text-sm font-bold text-fg">
                  Question {i + 1}
                </label>
                <textarea
                  id={`q-text-${q.id}`}
                  value={edited[q.id]?.question_text ?? q.question_text}
                  onChange={(e) => setEdited((m) => ({ ...m, [q.id]: { question_text: e.target.value, rubric: m[q.id]?.rubric ?? q.rubric ?? '' } }))}
                  disabled={busy}
                  className="min-h-[60px] w-full resize-y rounded-md border-2 border-sidebar-edge bg-surface px-2 py-1 text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                />
                {q.choices && q.choices.length > 0 && (
                  <p className="text-xs text-fg-muted">
                    Choices: {q.choices.join(' · ')}
                  </p>
                )}
                <label htmlFor={`q-rubric-${q.id}`} className="text-sm font-bold text-fg">
                  Grading note
                </label>
                <textarea
                  id={`q-rubric-${q.id}`}
                  value={edited[q.id]?.rubric ?? q.rubric ?? ''}
                  onChange={(e) => setEdited((m) => ({ ...m, [q.id]: { question_text: m[q.id]?.question_text ?? q.question_text, rubric: e.target.value } }))}
                  disabled={busy}
                  className="min-h-[44px] w-full resize-y rounded-md border-2 border-sidebar-edge bg-surface px-2 py-1 text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                />
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2 border-t-2 border-sidebar-edge pt-4">
          <button
            type="button"
            onClick={onSave}
            disabled={busy}
            className="rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-bold text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
          >
            Save changes
          </button>
          {isPublished ? (
            <button
              type="button"
              onClick={onUnpublish}
              disabled={busy}
              className="rounded-md border-2 border-sidebar-edge bg-warn px-4 py-2 font-bold text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
            >
              Unpublish
            </button>
          ) : (
            <button
              type="button"
              onClick={onPublish}
              disabled={busy || isStillBuilding}
              aria-disabled={isStillBuilding}
              title={isStillBuilding ? 'Questions are still being built — come back in a moment' : undefined}
              className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-bold text-fg-on-brand shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
            >
              Publish for students
            </button>
          )}
          <button
            type="button"
            onClick={onArchive}
            disabled={busy}
            className="rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
          >
            Archive
          </button>
        </div>

        {error && (
          <p role="alert" className="text-sm text-fg">{error}</p>
        )}
        {/* classId is carried for parity with the page links; referenced to keep it load-bearing */}
        <span hidden data-class={classId} />
      </aside>
    </>
  );
}

export default QuizLibrary;
