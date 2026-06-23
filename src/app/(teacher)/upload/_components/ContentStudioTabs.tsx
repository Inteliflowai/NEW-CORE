'use client';

/**
 * ContentStudioTabs — the three input modes of the Content Studio: Upload a file, From a URL,
 * Generate with AI. ARIA tablist with roving arrow-key selection. Token-only; deep-ink. One
 * sidebar entry; this is the whole "create a lesson" surface. Strings DRAFT → Barb.
 */
import React, { useRef, useState } from 'react';
import { UploadStudio, type UploadLessonLite } from './UploadStudio';
import UrlImportStudio from './UrlImportStudio';
import GenerateLessonStudio from './GenerateLessonStudio';

export interface ContentStudioTabsProps {
  classId: string;
  existingLessons: UploadLessonLite[];
  schoolState: string | null;
}

const TABS = [
  { id: 'upload', label: 'Upload a file' },
  { id: 'url', label: 'From a URL' },
  { id: 'generate', label: 'Generate with AI' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function ContentStudioTabs({ classId, existingLessons, schoolState }: ContentStudioTabsProps): React.JSX.Element {
  const [active, setActive] = useState<TabId>('upload');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = e.key === 'ArrowRight' ? (index + 1) % TABS.length : (index - 1 + TABS.length) % TABS.length;
    setActive(TABS[next].id);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Create a lesson" className="flex flex-wrap gap-2">
        {TABS.map((t, i) => (
          <button
            key={t.id} type="button" role="tab" id={`cs-tab-${t.id}`} aria-controls="cs-tabpanel"
            aria-selected={active === t.id} tabIndex={active === t.id ? 0 : -1}
            ref={(el) => { tabRefs.current[i] = el; }}
            onClick={() => setActive(t.id)} onKeyDown={(e) => onKeyDown(e, i)}
            className={[
              'rounded-md border-2 border-sidebar-edge px-4 py-2 font-display text-sm font-bold shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
              active === t.id ? 'bg-brand text-fg-on-brand' : 'bg-surface text-fg',
            ].join(' ')}
          >{t.label}</button>
        ))}
      </div>

      <div role="tabpanel" id="cs-tabpanel" aria-labelledby={`cs-tab-${active}`}>
        {active === 'upload' && <UploadStudio classId={classId} existingLessons={existingLessons} />}
        {active === 'url' && <UrlImportStudio classId={classId} existingLessons={existingLessons} />}
        {active === 'generate' && <GenerateLessonStudio classId={classId} schoolState={schoolState} />}
      </div>
    </div>
  );
}

export default ContentStudioTabs;
