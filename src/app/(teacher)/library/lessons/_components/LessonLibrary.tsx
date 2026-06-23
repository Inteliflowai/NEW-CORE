'use client';

/**
 * LessonLibrary — the teacher's flat, searchable list of lessons (Content Studio Seg 1).
 *
 * Each row is Card-chrome (pop-art: border-2 border-sidebar-edge + shadow-sticker): the lesson
 * title (font-display), a SectionLabel status pill (label only — never the band/diagnostic enum),
 * subject · grade, and the quiz state with a primary action — "Make a quiz" when none exists,
 * "Open quiz" when one does (links carry ?class= forward to the Quiz Library).
 *
 * A top filter bar narrows the list: a search box (title/subject) + a date-granularity select
 * (All · This month · This week · Today, bucketed off created_at). An empty result — or a cold
 * start — shows the dignified EmptyState plus an "Upload a lesson" affordance.
 *
 * "Assignments", never "Homework". Token-only Tailwind v4 (no hardcoded hex / arbitrary [var(--..)]);
 * content text is deep-ink (text-fg). All user-facing strings are DRAFTS → Barb
 * (STRINGS-FOR-BARB.md §Content Studio).
 */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import type { LessonLibrary as LessonLibraryData, LessonLibRow } from '@/lib/lessons/loadLessonLibrary';
import { EmptyState } from '@/components/core/EmptyState';
import { SectionLabel } from '../../../_components/SectionLabel';
import { inBucket, type DateBucket } from '@/lib/content/dateBucket';

/** Status → a plain, label-only pill (NO diagnostic enum, NO band machinery). DRAFT → Barb. */
function statusPill(status: string): { label: string; tone: 'brand' | 'ok' | 'warn' } {
  switch (status) {
    case 'published':
      return { label: 'Published', tone: 'ok' };
    case 'pending_review':
      return { label: 'Ready to review', tone: 'brand' };
    case 'draft':
    default:
      return { label: 'Draft', tone: 'warn' };
  }
}

function LessonRow({ lesson, classId }: { lesson: LessonLibRow; classId: string }): React.JSX.Element {
  const pill = statusPill(lesson.status);
  const meta = [lesson.subject, lesson.grade_level ? `Grade ${lesson.grade_level}` : null]
    .filter(Boolean)
    .join(' · ');
  const hasQuiz = lesson.quiz_count > 0;
  const quizHref = `/library/quizzes?class=${encodeURIComponent(classId)}`;
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border-2 border-sidebar-edge bg-surface p-4 shadow-sticker">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-base font-bold text-fg">{lesson.title}</h3>
          <SectionLabel tone={pill.tone}>{pill.label}</SectionLabel>
        </div>
        {meta && <p className="text-fg text-xs">{meta}</p>}
        <p className="text-fg text-xs">
          {hasQuiz ? (lesson.quiz_count === 1 ? '1 quiz ready' : `${lesson.quiz_count} quizzes ready`) : 'No quiz yet'}
        </p>
      </div>
      <Link
        href={quizHref}
        className="shrink-0 rounded-md border-2 border-sidebar-edge bg-brand px-3 py-1.5 font-display text-sm font-bold text-fg-on-brand shadow-sticker"
      >
        {hasQuiz ? 'Open quiz' : 'Make a quiz'}
      </Link>
    </div>
  );
}

export function LessonLibrary({
  data,
  now,
}: {
  data: LessonLibraryData;
  now?: Date;
}): React.JSX.Element {
  const clock = now ?? new Date();
  const [query, setQuery] = useState('');
  const [bucket, setBucket] = useState<DateBucket>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.lessons.filter((l) => {
      if (!inBucket(l.created_at, bucket, clock)) return false;
      if (!q) return true;
      const hay = `${l.title} ${l.subject ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [data.lessons, query, bucket, clock]);

  const uploadHref = `/upload?class=${encodeURIComponent(data.class_id)}`;

  // Cold start — no lessons at all.
  if (data.lessons.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4">
        <EmptyState
          variant="just-getting-started"
          titleOverride="No lessons yet"
          bodyOverride="Upload a lesson and we'll draft a quiz you can review."
        />
        <Link
          href={uploadHref}
          className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker"
        >
          Upload a lesson
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-fg-muted">Search</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a lesson"
            className="rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1.5 text-fg text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-fg-muted">Added</span>
          <select
            value={bucket}
            onChange={(e) => setBucket(e.target.value as DateBucket)}
            className="rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1.5 text-fg text-sm"
          >
            <option value="all">All time</option>
            <option value="month">This month</option>
            <option value="week">This week</option>
            <option value="today">Today</option>
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          variant="just-getting-started"
          titleOverride="Nothing matches"
          bodyOverride="Try a different search or date."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((l) => (
            <LessonRow key={l.id} lesson={l} classId={data.class_id} />
          ))}
        </div>
      )}
    </div>
  );
}

export default LessonLibrary;
