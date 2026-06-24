'use client';

/**
 * RosterImportTabs — ARIA tablist for the Import Roster page.
 * Two tabs: From a file → <RosterFileImport>; From Google Classroom → <ImportWizard>.
 * Mirrors the ContentStudioTabs roving-key pattern exactly.
 * Strings DRAFT → Barb (§ Import Roster).
 */
import React, { useRef, useState } from 'react';
import RosterFileImport from './RosterFileImport';
import ImportWizard from '../google/_components/ImportWizard';

export interface RosterImportTabsProps {
  canFull: boolean;
  canLean: boolean;
  classId: string | null;
}

const TABS = [
  { id: 'file', label: 'From a file' },
  { id: 'google', label: 'From Google Classroom' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function RosterImportTabs({ canFull, canLean, classId }: RosterImportTabsProps): React.JSX.Element {
  const [active, setActive] = useState<TabId>('file');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = e.key === 'ArrowRight'
      ? (index + 1) % TABS.length
      : (index - 1 + TABS.length) % TABS.length;
    setActive(TABS[next].id);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Import roster" className="flex flex-wrap gap-2">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`ri-tab-${t.id}`}
            aria-controls="ri-tabpanel"
            aria-selected={active === t.id}
            tabIndex={active === t.id ? 0 : -1}
            ref={(el) => { tabRefs.current[i] = el; }}
            onClick={() => setActive(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={[
              'rounded-md border-2 border-sidebar-edge px-4 py-2 font-display text-sm font-bold shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
              active === t.id ? 'bg-brand text-fg-on-brand' : 'bg-surface text-fg',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="ri-tabpanel" aria-labelledby={`ri-tab-${active}`}>
        {active === 'file' && <RosterFileImport canFull={canFull} canLean={canLean} classId={classId} />}
        {active === 'google' && <ImportWizard />}
      </div>
    </div>
  );
}

export default RosterImportTabs;
