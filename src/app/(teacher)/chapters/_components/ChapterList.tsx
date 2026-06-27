'use client';

// ChapterList — teacher chapter management UI (Segment 1, Task 7).
// Shows chapters for the active class: expandable accordion, inline add form,
// up/down reorder, soft archive. Each chapter shows assigned lessons + a picker
// for unassigned lessons. "Create Test" CTA is wired in Seg 2.
//
// Token-only Tailwind (no hardcoded hex). User-facing strings → STRINGS-FOR-BARB.md §Chapter Eval.

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChapterTestGenerator } from './ChapterTestGenerator';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChapterTestRow {
  id: string;
  title: string;
  status: 'draft' | 'published' | 'archived';
  generation_status: 'draft' | 'queued' | 'generating' | 'ready' | 'failed';
}

export interface ChapterRow {
  id: string;
  class_id: string;
  title: string;
  description: string | null;
  sequence: number;
  created_at: string;
  archived_at: string | null;
  lesson_count: number;
}

export interface LessonRow {
  id: string;
  title: string | null;
  chapter_id: string | null;
}

export interface ChapterListProps {
  classId: string;
  chapters: ChapterRow[];
  lessons: LessonRow[];
  /** Map of chapter_id → most-recent non-archived chapter_test row, loaded server-side. */
  chapterTests?: Record<string, ChapterTestRow>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ChapterList({ classId, chapters, lessons, chapterTests = {} }: ChapterListProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [addTitle, setAddTitle] = useState('');
  const [addDesc, setAddDesc] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // ── Expand / collapse ──────────────────────────────────────────────────────

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Add chapter ────────────────────────────────────────────────────────────

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = addTitle.trim();
    if (!title) return;

    setIsAdding(true);
    setAddError(null);

    try {
      const res = await fetch('/api/teacher/chapters', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          classId,
          title,
          description: addDesc.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setAddError(body.error ?? 'Could not add chapter');
        return;
      }

      setAddTitle('');
      setAddDesc('');
      setShowAdd(false);
      router.refresh();
    } finally {
      setIsAdding(false);
    }
  };

  // ── Archive chapter (soft delete) ──────────────────────────────────────────

  const handleArchive = async (chapterId: string, title: string) => {
    if (
      !window.confirm(
        `Archive "${title}"? Students will no longer see tests for this chapter.`,
      )
    ) {
      return;
    }

    await fetch(`/api/teacher/chapters/${chapterId}`, { method: 'DELETE' });
    router.refresh();
  };

  // ── Reorder (swap sequences) ────────────────────────────────────────────────

  const handleMoveUp = async (chapter: ChapterRow, idx: number) => {
    if (idx === 0) return;
    const prev = chapters[idx - 1];
    await Promise.all([
      fetch(`/api/teacher/chapters/${chapter.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sequence: prev.sequence }),
      }),
      fetch(`/api/teacher/chapters/${prev.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sequence: chapter.sequence }),
      }),
    ]);
    router.refresh();
  };

  const handleMoveDown = async (chapter: ChapterRow, idx: number) => {
    if (idx === chapters.length - 1) return;
    const next = chapters[idx + 1];
    await Promise.all([
      fetch(`/api/teacher/chapters/${chapter.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sequence: next.sequence }),
      }),
      fetch(`/api/teacher/chapters/${next.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sequence: chapter.sequence }),
      }),
    ]);
    router.refresh();
  };

  // ── Lesson assignment ─────────────────────────────────────────────────────

  const handleAssignLesson = async (chapterId: string, lessonId: string) => {
    await fetch(`/api/teacher/chapters/${chapterId}/lessons`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lessonIds: [lessonId] }),
    });
    router.refresh();
  };

  const handleUnassignLesson = async (chapterId: string, lessonId: string) => {
    await fetch(`/api/teacher/chapters/${chapterId}/lessons/${lessonId}`, {
      method: 'DELETE',
    });
    router.refresh();
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  const assignedLessons = (chapterId: string) =>
    lessons.filter((l) => l.chapter_id === chapterId);

  const unassignedLessons = lessons.filter((l) => !l.chapter_id);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3">
      {/* Empty state */}
      {chapters.length === 0 && !showAdd && (
        <p className="text-sm text-fg-muted">
          No chapters yet. Add one to start organising your lessons.
        </p>
      )}

      {/* Chapter rows */}
      {chapters.map((chapter, idx) => {
        const isOpen = expanded.has(chapter.id);
        const assigned = assignedLessons(chapter.id);

        return (
          <div
            key={chapter.id}
            className="rounded-lg border-2 border-sidebar-edge bg-surface shadow-sticker"
          >
            {/* Header row */}
            <div className="flex items-center gap-2 px-4 py-3">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`chapter-${chapter.id}-content`}
                aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${chapter.title}`}
                onClick={() => toggleExpand(chapter.id)}
                className="flex-1 text-left font-display text-sm font-bold text-fg hover:text-brand"
              >
                {chapter.title}
              </button>

              <span className="shrink-0 text-xs text-fg-muted">
                {chapter.lesson_count} lesson{chapter.lesson_count !== 1 ? 's' : ''}
              </span>

              {/* Up/down reorder */}
              <button
                type="button"
                aria-label={`Move ${chapter.title} up`}
                onClick={() => handleMoveUp(chapter, idx)}
                disabled={idx === 0}
                className="rounded px-1 py-0.5 text-xs text-fg-muted hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
              >
                ▲
              </button>
              <button
                type="button"
                aria-label={`Move ${chapter.title} down`}
                onClick={() => handleMoveDown(chapter, idx)}
                disabled={idx === chapters.length - 1}
                className="rounded px-1 py-0.5 text-xs text-fg-muted hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
              >
                ▼
              </button>

              {/* Archive */}
              <button
                type="button"
                aria-label={`Archive ${chapter.title}`}
                onClick={() => handleArchive(chapter.id, chapter.title)}
                className="rounded px-2 py-0.5 text-xs text-risk hover:bg-risk-surface"
              >
                Archive
              </button>
            </div>

            {/* Expanded content */}
            {isOpen && (
              <div
                id={`chapter-${chapter.id}-content`}
                className="border-t border-sidebar-edge px-4 pb-4 pt-3"
              >
                {/* Assigned lessons */}
                <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-fg-muted">
                  Lessons in this chapter
                </h3>
                {assigned.length === 0 ? (
                  <p className="text-xs text-fg-muted">No lessons assigned yet.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {assigned.map((l) => (
                      <li
                        key={l.id}
                        className="flex items-center justify-between gap-2 text-sm text-fg"
                      >
                        <span>{l.title ?? 'Untitled lesson'}</span>
                        <button
                          type="button"
                          onClick={() => handleUnassignLesson(chapter.id, l.id)}
                          className="shrink-0 text-xs text-fg-muted hover:text-risk"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Unassigned lesson picker */}
                {unassignedLessons.length > 0 && (
                  <div className="mt-3">
                    <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-fg-muted">
                      Add lessons
                    </h3>
                    <ul className="flex flex-col gap-1">
                      {unassignedLessons.map((l) => (
                        <li
                          key={l.id}
                          className="flex items-center justify-between gap-2 text-sm text-fg"
                        >
                          <span>{l.title ?? 'Untitled lesson'}</span>
                          <button
                            type="button"
                            onClick={() => handleAssignLesson(chapter.id, l.id)}
                            className="shrink-0 text-xs font-semibold text-brand hover:underline"
                          >
                            Add
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Chapter Test Generator */}
                <div className="mt-4">
                  <ChapterTestGenerator
                    chapterId={chapter.id}
                    chapterTitle={chapter.title}
                    existingTest={chapterTests[chapter.id] ?? null}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Add chapter form or trigger */}
      {showAdd ? (
        <form
          onSubmit={handleAdd}
          className="rounded-lg border-2 border-sidebar-edge bg-surface p-4 shadow-sticker"
        >
          <h3 className="mb-3 font-display text-sm font-bold text-fg">Add chapter</h3>

          {addError && (
            <p role="alert" className="mb-2 text-xs text-risk">
              {addError}
            </p>
          )}

          <div className="flex flex-col gap-2">
            <input
              type="text"
              aria-label="Chapter title"
              placeholder="Chapter title"
              value={addTitle}
              onChange={(e) => setAddTitle(e.target.value)}
              required
              className="rounded border border-sidebar-edge bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-brand"
            />
            <input
              type="text"
              aria-label="Chapter description"
              placeholder="Description (optional)"
              value={addDesc}
              onChange={(e) => setAddDesc(e.target.value)}
              className="rounded border border-sidebar-edge bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-brand"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isAdding || !addTitle.trim()}
                className="rounded-lg bg-brand px-3 py-1.5 text-sm font-bold text-fg-on-brand disabled:opacity-50"
              >
                {isAdding ? 'Adding…' : 'Add chapter'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAdd(false);
                  setAddTitle('');
                  setAddDesc('');
                  setAddError(null);
                }}
                className="rounded-lg border-2 border-sidebar-edge px-3 py-1.5 text-sm text-fg hover:bg-surface"
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 rounded-lg border-2 border-dashed border-sidebar-edge px-4 py-3 text-sm font-bold text-fg-muted hover:border-brand hover:text-fg"
        >
          ＋ Add chapter
        </button>
      )}
    </div>
  );
}

export default ChapterList;
