'use client';

/**
 * LessonLibraryWithCreate — wraps the Lesson Library with a "＋ Create a lesson" toggle that
 * slides into the Content Studio authoring tabs in-place, without a page navigation. The "Create"
 * button is present in browse mode; a "← Back to library" button appears in create mode.
 *
 * Token-only Tailwind v4; deep-ink content text; keyboard-accessible buttons with discernible text.
 * Strings DRAFT → Barb (STRINGS-FOR-BARB.md §Content Studio).
 */

import React, { useState } from 'react';
import { LessonLibrary } from './LessonLibrary';
import { ContentStudioTabs } from '../../../upload/_components/ContentStudioTabs';
import type { LessonLibrary as LessonLibraryData } from '@/lib/lessons/loadLessonLibrary';
import type { LibraryClassOption } from '@/lib/teacher/teacherClasses';
import type { UploadLessonLite } from '../../../upload/_components/UploadStudio';

type View = 'browse' | 'create';

export interface LessonLibraryWithCreateProps {
  data: LessonLibraryData;
  classes: LibraryClassOption[];
  classId: string;
  existingLessons: UploadLessonLite[];
  schoolState: string | null;
}

export function LessonLibraryWithCreate({
  data,
  classes,
  classId,
  existingLessons,
  schoolState,
}: LessonLibraryWithCreateProps): React.JSX.Element {
  const [view, setView] = useState<View>('browse');

  if (view === 'create') {
    return (
      <div className="flex flex-col gap-4">
        {/* Back affordance */}
        <div>
          <button
            type="button"
            onClick={() => setView('browse')}
            className="rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            aria-label="Back to library"
          >
            ← Back to library
          </button>
        </div>

        {/* Full Content Studio authoring tabs */}
        <ContentStudioTabs
          classId={classId}
          existingLessons={existingLessons}
          schoolState={schoolState}
        />
      </div>
    );
  }

  // browse view
  return (
    <div className="flex flex-col gap-4">
      {/* Create toggle — sits above the library list */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setView('create')}
          className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          aria-pressed={false}
        >
          ＋ Create a lesson
        </button>
      </div>

      {/* Existing library */}
      <LessonLibrary data={data} classes={classes} />
    </div>
  );
}

export default LessonLibraryWithCreate;
