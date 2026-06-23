'use client';

/**
 * CategoryFilterBar — the shared filter bar for both Content Studio libraries (Lesson + Quiz):
 * Class · Subject · Grade · date · search. Class navigates (`?class=`, one class at a time);
 * Subject / Grade / date / search are controlled client-side filters owned by the parent library.
 *
 * The date label varies by surface ("Added" on lessons, "When" on quizzes) and the search
 * placeholder varies too — both come in as props so the existing per-library labels are preserved.
 * Token-only Tailwind v4; deep-ink text. All strings → Barb.
 */

import React from 'react';
import { ClassSelect } from './ClassSelect';
import type { LibraryClassOption } from '@/lib/teacher/teacherClasses';
import type { DateBucket } from '@/lib/content/dateBucket';

const LABEL = 'text-[10px] font-bold uppercase tracking-[0.16em] text-fg-muted';
const FIELD =
  'rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1.5 text-fg text-sm shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

export interface CategoryFilterBarProps {
  classes: LibraryClassOption[];
  currentClassId: string;
  classBasePath: string;

  search: string;
  onSearch: (v: string) => void;
  searchPlaceholder: string;

  subjects: string[];
  subject: string; // 'all' | a subject
  onSubject: (v: string) => void;

  grades: string[];
  grade: string; // 'all' | a grade
  onGrade: (v: string) => void;

  bucket: DateBucket;
  onBucket: (v: DateBucket) => void;
  dateLabel: string;
}

/** Display a grade value the same way the section headers do (prefix "Grade " unless it already
 *  says "grade"), so the dropdown reads "Grade 7" / "7th grade" consistently. */
function gradeOptionLabel(g: string): string {
  return /grade/i.test(g) ? g : `Grade ${g}`;
}

export function CategoryFilterBar(props: CategoryFilterBarProps): React.JSX.Element {
  const {
    classes, currentClassId, classBasePath,
    search, onSearch, searchPlaceholder,
    subjects, subject, onSubject,
    grades, grade, onGrade,
    bucket, onBucket, dateLabel,
  } = props;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <ClassSelect classes={classes} currentClassId={currentClassId} basePath={classBasePath} />

      <label className="flex flex-col gap-1">
        <span className={LABEL}>Search</span>
        <input
          type="search"
          role="searchbox"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className={FIELD}
        />
      </label>

      {subjects.length > 0 && (
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Subject</span>
          <select aria-label="Subject" value={subject} onChange={(e) => onSubject(e.target.value)} className={FIELD}>
            <option value="all">All subjects</option>
            {subjects.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      )}

      {grades.length > 0 && (
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Grade</span>
          <select aria-label="Grade" value={grade} onChange={(e) => onGrade(e.target.value)} className={FIELD}>
            <option value="all">All grades</option>
            {grades.map((g) => (
              <option key={g} value={g}>{gradeOptionLabel(g)}</option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1">
        <span className={LABEL}>{dateLabel}</span>
        <select aria-label={dateLabel} value={bucket} onChange={(e) => onBucket(e.target.value as DateBucket)} className={FIELD}>
          <option value="all">All time</option>
          <option value="month">This month</option>
          <option value="week">This week</option>
          <option value="today">Today</option>
        </select>
      </label>
    </div>
  );
}

export default CategoryFilterBar;
