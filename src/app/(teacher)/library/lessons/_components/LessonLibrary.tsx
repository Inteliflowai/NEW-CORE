'use client';

/**
 * LessonLibrary — the teacher's searchable list of lessons (Content Studio Seg 1), grouped into
 * Subject · Grade section headers and sliced by a shared filter bar: Class (one at a time) ·
 * Subject · Grade · date · search.
 *
 * Each row is Card-chrome (pop-art: border-2 border-sidebar-edge + shadow-sticker): the lesson
 * title (font-display), a SectionLabel status pill (label only — never the band/diagnostic enum),
 * subject · grade, the quiz state, a "View lesson" button that opens the read-only lesson-plan
 * panel (LessonViewPanel), and the quiz action — "Make a quiz" when none exists, "Open quiz" when
 * one does (links carry ?class= forward to the Quiz Library).
 *
 * An empty result — or a cold start — shows the dignified EmptyState plus an "Upload a lesson"
 * affordance. "Assignments", never "Homework". Token-only Tailwind v4 (no hardcoded hex / arbitrary
 * [var(--..)]); content text is deep-ink (text-fg). All user-facing strings are DRAFTS → Barb
 * (STRINGS-FOR-BARB.md §Content Studio).
 */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import type { LessonLibrary as LessonLibraryData, LessonLibRow } from '@/lib/lessons/loadLessonLibrary';
import type { LibraryClassOption } from '@/lib/teacher/teacherClasses';
import { EmptyState } from '@/components/core/EmptyState';
import { SectionLabel } from '../../../_components/SectionLabel';
import { CategoryFilterBar } from '../../_components/CategoryFilterBar';
import { inBucket, type DateBucket } from '@/lib/content/dateBucket';
import { clean, distinctValues, groupByCategory } from '@/lib/content/category';
import { LessonViewPanel } from './LessonViewPanel';

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

/** Per-lesson GC publish state: idle | busy | done | needsReconnect. */
type GcPublishState = 'idle' | 'busy' | 'done' | 'needsReconnect';

function LessonRow({
  lesson,
  classId,
  onView,
  gcState,
  onPublishToClassroom,
}: {
  lesson: LessonLibRow;
  classId: string;
  onView: () => void;
  gcState?: GcPublishState;
  onPublishToClassroom?: () => void;
}): React.JSX.Element {
  const pill = statusPill(lesson.status);
  const meta = [lesson.subject, lesson.grade_level ? `Grade ${lesson.grade_level}` : null]
    .filter(Boolean)
    .join(' · ');
  // Light unit grouping — surface the unit + day position when the lesson belongs to a unit.
  const unitMeta = lesson.chapter_title
    ? `Unit: ${lesson.chapter_title}${lesson.day_index != null ? ` · Day ${lesson.day_index}` : ''}`
    : null;
  const hasQuiz = lesson.quiz_count > 0;
  const quizHref = `/library/quizzes?class=${encodeURIComponent(classId)}`;
  const rowGcState = gcState ?? 'idle';
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border-2 border-sidebar-edge bg-surface p-4 shadow-sticker">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-base font-bold text-fg">{lesson.title}</h3>
          <SectionLabel tone={pill.tone}>{pill.label}</SectionLabel>
        </div>
        {meta && <p className="text-fg text-xs">{meta}</p>}
        {unitMeta && <p className="text-fg text-xs">{unitMeta}</p>}
        <p className="text-fg text-xs">
          {hasQuiz ? (lesson.quiz_count === 1 ? '1 quiz ready' : `${lesson.quiz_count} quizzes ready`) : 'No quiz yet'}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onView}
          aria-label={`View lesson — ${lesson.title}`}
          className="rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1.5 font-display text-sm font-bold text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          View lesson
        </button>
        <Link
          href={quizHref}
          aria-label={`${hasQuiz ? 'Open quiz' : 'Make a quiz'} — ${lesson.title}`}
          className="rounded-md border-2 border-sidebar-edge bg-brand px-3 py-1.5 font-display text-sm font-bold text-fg-on-brand shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {hasQuiz ? 'Open quiz' : 'Make a quiz'}
        </Link>
        {/* GC publish — gated on presence of onPublishToClassroom (passed only when googleCourseId is set) */}
        {onPublishToClassroom && (
          <>
            {rowGcState === 'done' ? (
              <span className="text-sm text-fg-muted">Sent to Classroom</span>
            ) : rowGcState === 'needsReconnect' ? (
              <a
                href="/settings/google"
                className="text-sm font-bold text-brand underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Reconnect Google
              </a>
            ) : (
              <button
                type="button"
                onClick={onPublishToClassroom}
                disabled={rowGcState === 'busy'}
                aria-label={`Publish to Classroom — ${lesson.title}`}
                className="rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1.5 font-display text-sm font-bold text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
              >
                {rowGcState === 'busy' ? 'Publishing…' : 'Publish to Classroom'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function LessonLibrary({
  data,
  classes = [],
  now,
  onCreate,
  googleCourseId,
}: {
  data: LessonLibraryData;
  classes?: LibraryClassOption[];
  now?: Date;
  /** Optional callback to switch the parent into a create/upload view. When present, the cold-start
   * CTA becomes a button instead of a /upload link to avoid a redirect loop. */
  onCreate?: () => void;
  /** When set, shows "Publish to Classroom" on each row (fetched server-side via admin client).
   *  Absent/null → the action is hidden (class is not GC-mirrored). */
  googleCourseId?: string | null;
}): React.JSX.Element {
  const clock = now ?? new Date();
  const [query, setQuery] = useState('');
  const [bucket, setBucket] = useState<DateBucket>('all');
  const [subject, setSubject] = useState('all');
  const [grade, setGrade] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Per-lesson GC publish state (keyed by lesson id).
  const [gcState, setGcState] = useState<Record<string, GcPublishState>>({});

  async function publishLessonToClassroom(lessonId: string) {
    if (gcState[lessonId] === 'busy') return;
    setGcState((s) => ({ ...s, [lessonId]: 'busy' }));
    try {
      const res = await fetch('/api/teacher/google/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId: data.class_id, resourceType: 'assignment', resourceId: lessonId }),
      });
      const json = await res.json() as { needsReconnect?: boolean };
      if (!res.ok && json.needsReconnect) {
        setGcState((s) => ({ ...s, [lessonId]: 'needsReconnect' }));
      } else if (!res.ok) {
        setGcState((s) => ({ ...s, [lessonId]: 'idle' }));
      } else {
        setGcState((s) => ({ ...s, [lessonId]: 'done' }));
      }
    } catch {
      setGcState((s) => ({ ...s, [lessonId]: 'idle' }));
    }
  }

  const subjectOptions = useMemo(() => distinctValues(data.lessons, (l) => l.subject), [data.lessons]);
  const gradeOptions = useMemo(() => distinctValues(data.lessons, (l) => l.grade_level), [data.lessons]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.lessons.filter((l) => {
      if (!inBucket(l.created_at, bucket, clock)) return false;
      // Compare via clean() so a whitespace-bearing stored value matches its trimmed dropdown option.
      if (subject !== 'all' && clean(l.subject) !== subject) return false;
      if (grade !== 'all' && clean(l.grade_level) !== grade) return false;
      if (!q) return true;
      const hay = `${l.title} ${l.subject ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [data.lessons, query, bucket, subject, grade, clock]);

  // Within a Subject · Grade group, order unit lessons by their day position (lessons not in a unit
  // keep the loader's newest-first order). Light grouping only — no new grouped layout.
  const groups = useMemo(() => {
    return groupByCategory(filtered).map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => {
        // Only reorder when BOTH belong to the SAME unit; otherwise preserve the incoming order.
        if (a.chapter_title && b.chapter_title && a.chapter_title === b.chapter_title) {
          return (a.day_index ?? 0) - (b.day_index ?? 0);
        }
        return 0;
      }),
    }));
  }, [filtered]);
  const selected = selectedId ? data.lessons.find((l) => l.id === selectedId) ?? null : null;

  const uploadHref = `/upload?class=${encodeURIComponent(data.class_id)}`;

  // Cold start — no lessons at all.
  if (data.lessons.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4">
        <EmptyState
          variant="just-getting-started"
          titleOverride="No lessons yet"
          bodyOverride="Create a lesson and we'll draft a quiz you can review."
        />
        {onCreate ? (
          <button
            type="button"
            onClick={onCreate}
            className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Create a lesson
          </button>
        ) : (
          <Link
            href={uploadHref}
            className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker"
          >
            Upload a lesson
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <CategoryFilterBar
        classes={classes}
        currentClassId={data.class_id}
        classBasePath="/library/lessons"
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Find a lesson"
        subjects={subjectOptions}
        subject={subject}
        onSubject={setSubject}
        grades={gradeOptions}
        grade={grade}
        onGrade={setGrade}
        bucket={bucket}
        onBucket={setBucket}
        dateLabel="Added"
      />

      {filtered.length === 0 ? (
        <EmptyState
          variant="just-getting-started"
          titleOverride="Nothing matches"
          bodyOverride="Try a different search, subject, grade, or date."
        />
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <section key={group.key} className="flex flex-col gap-3">
              <h2 className="font-display text-xs font-extrabold uppercase tracking-[0.16em] text-fg-muted">
                {group.label}
              </h2>
              {group.items.map((l) => (
                <LessonRow
                  key={l.id}
                  lesson={l}
                  classId={data.class_id}
                  onView={() => setSelectedId(l.id)}
                  gcState={gcState[l.id]}
                  onPublishToClassroom={googleCourseId ? () => void publishLessonToClassroom(l.id) : undefined}
                />
              ))}
            </section>
          ))}
        </div>
      )}

      {selected && <LessonViewPanel lesson={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

export default LessonLibrary;
